// Audit P4 — BP critical-bypass (CLAUDE.md "Phase 4 Invariants"):
// sys < 90 or dia < 60 → low, sys > 180 or dia > 110 → high. Reuses the
// critical-alert chain with BP's own per-category cooldown.
//
// (Shared harness with critical-alert-durable-enqueue.test.ts.)
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

const bpBody = (clientUuid: string, systolic: number, diastolic: number) => ({
  clientUuid,
  systolic,
  diastolic,
  context: "normal",
  source: "manual",
  measuredAt: new Date().toISOString(),
  version: 1,
});

const postBP = (token: string, body: ReturnType<typeof bpBody>) =>
  request(app).post("/api/v1/readings/bp").set("Authorization", `Bearer ${token}`).send(body);

describe("BP critical bypass (audit P4)", () => {
  it.each([
    [190, 100, "high"],
    [150, 115, "high"],
    [85, 70, "low"],
    [120, 55, "low"],
  ] as const)("%i/%i → critical %s, dispatched through the shared chain", async (sys, dia, dir) => {
    const seed = await seedPatient();
    const res = await postBP(seed.token, bpBody(randomUUID(), sys, dia));
    expect(res.status).toBe(201);
    expect(res.body.data.critical).toMatchObject({
      isCritical: true,
      direction: dir,
      withinCooldown: false,
    });

    const id = res.body.data.reading.id as string;
    const jobs = await criticalJobsFor(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`critical-bp-${id}-v1`);

    // The worker sends the BP copy — both readings inline — to push + SMS.
    await processCriticalAlert({ id: jobs[0]!.id!, data: (jobs[0] as { data: unknown }).data });
    const pushed = sendExpoPushMock.mock.calls[0]![0] as { title: string; body: string }[];
    expect(pushed[0]!.title).toContain(dir === "high" ? "BP Bahut Zyada" : "BP Bahut Kam");
    expect(pushed[0]!.body).toContain(`${sys}/${dia}`);
    const sms = sendSmsBatchMock.mock.calls[0]![0] as { phone: string; message: string }[];
    expect(sms[0]!.phone).toBe(seed.contactPhone);
    expect(sms[0]!.message).toContain(`${sys}/${dia}`);
  });

  it.each([
    [180, 110],
    [90, 60],
    [128, 82],
  ])("%i/%i is not critical (thresholds are exclusive) — no dispatch", async (sys, dia) => {
    const seed = await seedPatient();
    const res = await postBP(seed.token, bpBody(randomUUID(), sys, dia));
    expect(res.status).toBe(201);
    expect(res.body.data.critical).toMatchObject({ isCritical: false, direction: null });
    expect(await criticalJobsFor(res.body.data.reading.id)).toHaveLength(0);
  });

  it("per-category cooldown: a 2nd critical BP is suppressed, a critical glucose still fires", async () => {
    const seed = await seedPatient();
    const first = await postBP(seed.token, bpBody(randomUUID(), 195, 120));
    expect(first.body.data.critical.withinCooldown).toBe(false);

    const second = await postBP(seed.token, bpBody(randomUUID(), 200, 125));
    expect(second.body.data.critical).toMatchObject({ isCritical: true, withinCooldown: true });
    expect(await criticalJobsFor(second.body.data.reading.id)).toHaveLength(0);

    const glucose = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(glucose.body.data.critical.withinCooldown).toBe(false);
    expect(await criticalJobsFor(glucose.body.data.reading.id)).toHaveLength(1);
  });

  it("the same reading resent is an idempotent replay (2xx, not 409) with still one job", async () => {
    const seed = await seedPatient();
    const body = bpBody(randomUUID(), 85, 55);
    const first = await postBP(seed.token, body);
    const replay = await postBP(seed.token, body);
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.data.reading.id).toBe(first.body.data.reading.id);
    expect(await criticalJobsFor(first.body.data.reading.id)).toHaveLength(1);
  });
});
