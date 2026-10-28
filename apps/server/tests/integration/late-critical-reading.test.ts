// Audit P33 — a critical reading that reaches the server more than 2h after
// it was taken (an offline queue drained later) used to page the family as
// a current emergency: it started the 30-min cooldown at sync time, so a
// REAL critical reading soon after reached nobody; it re-alerted the
// patient's own phone; and it scheduled the SOS escalation. Now the family
// gets a late notice with the time it was taken, and nothing else.
//
// (Harness shared with bp-critical-bypass.test.ts.)
//
import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Queue } from "bullmq";

const { sendExpoPushMock, sendSmsBatchMock, captureUnhandledMock } = vi.hoisted(() => ({
  sendExpoPushMock: vi.fn(),
  sendSmsBatchMock: vi.fn(),
  captureUnhandledMock: vi.fn(),
}));

vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: sendExpoPushMock,
}));
vi.mock("../../src/shared/notifications/msg91-sms.js", () => ({
  sendSmsBatch: sendSmsBatchMock,
}));
vi.mock("../../src/shared/observability/sentry.js", () => ({
  captureUnhandled: captureUnhandledMock,
  initSentry: vi.fn(),
  isSentryEnabled: vi.fn(() => false),
  warnIfMisconfigured: vi.fn(),
}));

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed (status ${result.status})`);
  }
};

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let criticalQueueName: string;

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("timescale/timescaledb:latest-pg16")
    .withDatabase("swasth_parivar_test")
    .start();
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('cardiac_logs', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('respiratory_logs', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('bp_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const queueModule = await import("../../src/shared/queue.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  await flagsModule.setFlag("cardiac_logging_enabled", true, "integration_test");
  await flagsModule.setFlag("respiratory_logging_enabled", true, "integration_test");
  flagsModule.__resetFlagCache();

  app = appModule.buildApp();
  prisma = dbModule.prisma;
  criticalQueueName = queueModule.QUEUE_NAMES.CRITICAL_ALERT;
}, 120_000);

afterAll(async () => {
  try {
    const dbModule = await import("../../src/shared/database.js");
    await dbModule.disconnectDatabase();
  } catch {
    /* ignore */
  }
  try {
    const cacheModule = await import("../../src/shared/redis.js");
    if (cacheModule.redis) await cacheModule.redis.quit();
  } catch {
    /* ignore */
  }
  try {
    const queueModule = await import("../../src/shared/queue.js");
    await queueModule.closeQueueConnection();
  } catch {
    /* ignore */
  }
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

beforeEach(() => {
  sendExpoPushMock.mockReset();
  sendSmsBatchMock.mockReset();
  captureUnhandledMock.mockReset();
  sendExpoPushMock.mockImplementation((messages: { to: string }[]) =>
    Promise.resolve(messages.map((m) => ({ token: m.to, success: true }))),
  );
  sendSmsBatchMock.mockImplementation((messages: { phone: string }[]) =>
    Promise.resolve(messages.map((m) => ({ phone: m.phone, success: true }))),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const randomPhone = (): string => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** Patient with their own device token and one emergency contact without the app. */
const seedPatient = async (): Promise<{
  patientId: string;
  token: string;
  contactPhone: string;
}> => {
  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: randomPhone(),
      name: "Shanti Test",
      age: 66,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  await prisma.pushToken.create({
    data: { userId: patient.id, token: `ExponentPushToken[${randomUUID()}]`, platform: "android" },
  });
  const contactPhone = randomPhone();
  await prisma.emergencyContact.create({
    data: {
      userId: patient.id,
      name: "Beta",
      phone: contactPhone,
      relationship: "son",
      priority: 1,
      isGuardian: false,
    },
  });
  const token = jwt.sign({ sub: patient.id, householdId: household.id }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
  return { patientId: patient.id, token, contactPhone };
};

/** Every critical-alert job (any state) for a reading. */
const criticalJobsFor = async (readingId: string): Promise<{ id?: string }[]> => {
  const { Redis } = await import("ioredis");
  const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const probe = new Queue(criticalQueueName, { connection: conn });
  try {
    const jobs = await probe.getJobs(
      ["waiting", "active", "delayed", "completed", "failed", "prioritized"],
      0,
      500,
    );
    return jobs.filter((j) => j.data?.readingId === readingId);
  } finally {
    await probe.close();
    await conn.quit();
  }
};

let processCriticalAlert: (job: { id: string; data: unknown }) => Promise<void>;

beforeAll(async () => {
  const processorModule = await import("../../src/workers/critical-alert.processor.js");
  processCriticalAlert = processorModule.processCriticalAlert as typeof processCriticalAlert;
});

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

/** Adds a guardian with the app: an emergency contact whose phone is a user with a push token. */
const addGuardianWithApp = async (patientId: string): Promise<string> => {
  const household = await prisma.household.create({ data: {} });
  const phone = randomPhone();
  const guardian = await prisma.user.create({
    data: { phone, name: "Beti", age: 35, householdId: household.id, onboardingComplete: true },
  });
  const pushToken = `ExponentPushToken[${randomUUID()}]`;
  await prisma.pushToken.create({
    data: { userId: guardian.id, token: pushToken, platform: "android" },
  });
  await prisma.emergencyContact.create({
    data: {
      userId: patientId,
      name: "Beti",
      phone,
      relationship: "daughter",
      priority: 2,
      isGuardian: true,
    },
  });
  return pushToken;
};

const glucoseBody = (valueMgDl: number, measuredAt: string, sentAt?: string) => ({
  clientUuid: randomUUID(),
  valueMgDl,
  readingType: "fasting",
  context: "normal",
  source: "manual",
  measuredAt,
  ...(sentAt !== undefined ? { sentAt } : {}),
  version: 1,
});

const post = (token: string, path: string, body: object) =>
  request(app).post(`/api/v1/readings/${path}`).set("Authorization", `Bearer ${token}`).send(body);

const escalationJobsFor = async (readingId: string): Promise<unknown[]> => {
  const { Redis } = await import("ioredis");
  const queueModule = await import("../../src/shared/queue.js");
  const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const probe = new Queue(queueModule.QUEUE_NAMES.CRITICAL_BYPASS_AUTO_ESCALATE, {
    connection: conn,
  });
  try {
    const jobs = await probe.getJobs(
      ["waiting", "active", "delayed", "completed", "failed", "prioritized"],
      0,
      500,
    );
    return jobs.filter((j) => j.data?.readingId === readingId);
  } finally {
    await probe.close();
    await conn.quit();
  }
};

const runJobFor = async (readingId: string): Promise<{ data: Record<string, unknown> }> => {
  const jobs = await criticalJobsFor(readingId);
  expect(jobs).toHaveLength(1);
  const job = jobs[0] as { id: string; data: Record<string, unknown> };
  await processCriticalAlert({ id: job.id, data: job.data });
  return job;
};

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { type: string };
}
const pushedMessages = (): PushMessage[] =>
  sendExpoPushMock.mock.calls.flatMap((c) => c[0] as PushMessage[]);
const smsTexts = (): string[] =>
  sendSmsBatchMock.mock.calls.flatMap((c) => (c[0] as { message: string }[]).map((m) => m.message));

describe("late critical glucose (audit P33)", () => {
  it("a critical reading synced 6h late gets a late notice: family only, no escalation", async () => {
    const seed = await seedPatient();
    const guardianToken = await addGuardianWithApp(seed.patientId);
    const patientToken = (await prisma.pushToken.findFirst({ where: { userId: seed.patientId } }))
      .token as string;

    const res = await post(seed.token, "glucose", glucoseBody(52, ago(6 * 60), ago(0)));
    expect(res.status).toBe(201);
    expect(res.body.data.critical).toMatchObject({ isCritical: true, withinCooldown: false });
    const id = res.body.data.reading.id as string;

    const job = await runJobFor(id);
    expect(job.data.late).toEqual({ measuredAtIso: expect.any(String) });

    // The guardian's phone gets a late notice; the patient's own phone gets nothing.
    const pushed = pushedMessages();
    expect(pushed.map((m) => m.to)).toEqual([guardianToken]);
    expect(pushed.map((m) => m.to)).not.toContain(patientToken);
    expect(pushed[0]!.data.type).toBe("critical_reading_late");
    expect(pushed[0]!.body).toContain("Sugar 52 mg/dL");
    // The contact without the app is texted, plain ASCII, one part.
    const sms = smsTexts();
    expect(sms).toHaveLength(1);
    expect(sms[0]).toContain("Sugar 52 mg/dL");
    expect(sms[0]).toContain("critical thi");
    expect(sms[0]).toMatch(/^[\x20-\x7E]+$/);
    expect(sms[0]!.length).toBeLessThanOrEqual(160);
    // Not an emergency: no SOS escalation, no on-call page.
    expect(await escalationJobsFor(id)).toHaveLength(0);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("doesn't start the cooldown: a real critical reading right after still alerts", async () => {
    const seed = await seedPatient();
    const late = await post(seed.token, "glucose", glucoseBody(48, ago(9 * 60), ago(0)));
    expect(late.status).toBe(201);
    const feedback = await prisma.feedbackEvent.findFirst({
      where: { readingId: late.body.data.reading.id },
    });
    expect(feedback.feedbackType).toBe("critical_warn_late");

    const now = await post(seed.token, "glucose", glucoseBody(45, ago(0), ago(0)));
    expect(now.body.data.critical).toMatchObject({ isCritical: true, withinCooldown: false });
    const job = await runJobFor(now.body.data.reading.id);
    expect(job.data.late).toBeUndefined();
    expect(pushedMessages()[0]!.data.type).toBe("critical_alert");
    expect(await escalationJobsFor(now.body.data.reading.id)).toHaveLength(1);
  });

  it("a phone whose clock is 3h behind still gets a live alert for a fresh reading", async () => {
    // Taken and sent a minute apart on the phone's clock: current.
    const seed = await seedPatient();
    const res = await post(seed.token, "glucose", glucoseBody(50, ago(3 * 60 + 1), ago(3 * 60)));
    const job = await runJobFor(res.body.data.reading.id);
    expect(job.data.late).toBeUndefined();
    const feedback = await prisma.feedbackEvent.findFirst({
      where: { readingId: res.body.data.reading.id },
    });
    expect(feedback.feedbackType).toBe("critical_warn");
  });

  it("an older app build (no sentAt) is aged by when the server got it", async () => {
    const seed = await seedPatient();
    const late = await post(seed.token, "glucose", glucoseBody(340, ago(5 * 60)));
    expect((await runJobFor(late.body.data.reading.id)).data.late).toBeDefined();

    const seed2 = await seedPatient();
    const current = await post(seed2.token, "glucose", glucoseBody(340, ago(10)));
    expect((await runJobFor(current.body.data.reading.id)).data.late).toBeUndefined();
  });

  it("a reading 2h old is still current; just over 2h is late", async () => {
    const seed = await seedPatient();
    const edge = await post(seed.token, "glucose", glucoseBody(50, ago(119), ago(0)));
    expect((await runJobFor(edge.body.data.reading.id)).data.late).toBeUndefined();

    const seed2 = await seedPatient();
    const over = await post(seed2.token, "glucose", glucoseBody(50, ago(125), ago(0)));
    expect((await runJobFor(over.body.data.reading.id)).data.late).toBeDefined();
  });
});

describe("late critical BP / cardiac / respiratory (audit P33)", () => {
  const bp = (systolic: number, diastolic: number, measuredAt: string, sentAt?: string) => ({
    clientUuid: randomUUID(),
    systolic,
    diastolic,
    context: "normal",
    source: "manual",
    measuredAt,
    ...(sentAt !== undefined ? { sentAt } : {}),
    version: 1,
  });

  it("a late critical BP: late notice, no cooldown, so a current one right after alerts", async () => {
    const seed = await seedPatient();
    const late = await post(seed.token, "bp", bp(200, 120, ago(8 * 60), ago(0)));
    expect(late.status).toBe(201);
    const lateJob = await runJobFor(late.body.data.reading.id);
    expect(lateJob.data.late).toBeDefined();
    expect(smsTexts()[0]).toContain("BP 200/120 mmHg");
    expect(smsTexts()[0]).toMatch(/^[\x20-\x7E]+$/);
    expect(await escalationJobsFor(late.body.data.reading.id)).toHaveLength(0);

    const now = await post(seed.token, "bp", bp(195, 118, ago(0), ago(0)));
    expect(now.body.data.critical).toMatchObject({ isCritical: true, withinCooldown: false });
    const job = await runJobFor(now.body.data.reading.id);
    expect(job.data.late).toBeUndefined();
  });

  it("a late critical cardiac log gets a late notice with the heart rate", async () => {
    const seed = await seedPatient();
    const res = await post(seed.token, "cardiac", {
      clientUuid: randomUUID(),
      heartRate: 35,
      source: "manual",
      measuredAt: ago(4 * 60),
      sentAt: ago(0),
      version: 1,
    });
    expect(res.status).toBe(201);
    const job = await runJobFor(res.body.data.reading.id);
    expect(job.data.late).toBeDefined();
    expect(smsTexts()[0]).toContain("Dhadkan 35/min");
    expect(await escalationJobsFor(res.body.data.reading.id)).toHaveLength(0);
  });

  it("a late severe-symptom respiratory log gets a late notice", async () => {
    const seed = await seedPatient();
    const res = await post(seed.token, "respiratory", {
      clientUuid: randomUUID(),
      symptomSeverity: "severe",
      source: "manual",
      measuredAt: ago(3 * 60),
      sentAt: ago(0),
      version: 1,
    });
    expect(res.status).toBe(201);
    const job = await runJobFor(res.body.data.reading.id);
    expect(job.data.late).toBeDefined();
    expect(smsTexts()[0]).toContain("Saans ki gambhir takleef");
  });
});

describe("replays are scoped to the reading's owner (P8 safety review W3)", () => {
  it("glucose: another profile's clientUuid is a new reading, not a replay of theirs", async () => {
    const a = await seedPatient();
    const b = await seedPatient();
    const body = glucoseBody(48, ago(0), ago(0));
    const mine = await post(a.token, "glucose", body);
    expect(mine.status).toBe(201);

    const theirs = await post(b.token, "glucose", { ...body, measuredAt: ago(1), valueMgDl: 50 });
    expect(theirs.status).toBe(201);
    expect(theirs.body.data.reading.id).not.toBe(mine.body.data.reading.id);
    expect(theirs.body.data.reading.userId).toBe(b.patientId);
    expect(theirs.body.data.reading.valueMgDl).toBe(50);
    // B's critical reading alerts B's family.
    expect(await criticalJobsFor(theirs.body.data.reading.id)).toHaveLength(1);
  });

  it.each(["cardiac", "respiratory"] as const)(
    "%s: another profile's clientUuid is a new log, not a replay of theirs",
    async (kind) => {
      const a = await seedPatient();
      const b = await seedPatient();
      const clientUuid = randomUUID();
      const body =
        kind === "cardiac"
          ? { clientUuid, heartRate: 72, source: "manual", version: 1 }
          : { clientUuid, peakFlow: 400, source: "manual", version: 1 };
      const mine = await post(a.token, kind, { ...body, measuredAt: ago(0) });
      expect(mine.status).toBe(201);
      const theirs = await post(b.token, kind, { ...body, measuredAt: ago(1) });
      expect(theirs.status).toBe(201);
      expect(theirs.body.data.reading.id).not.toBe(mine.body.data.reading.id);
      expect(theirs.body.data.reading.userId).toBe(b.patientId);
    },
  );
});
