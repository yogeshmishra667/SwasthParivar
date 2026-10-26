// Audit P5 — a saved critical reading must never lose its alert.
//
// Before: the alert was enqueued LAST (after the streak + feedback
// writes), an enqueue failure 500'd the request, and the client's retry
// was an idempotent replay that never re-enqueued — the alert was gone.
// With `maxRetriesPerRequest: null` a Redis outage didn't even fail the
// add; it hung.
//
// Real Postgres + Redis (Testcontainers). Only the external push / SMS
// providers and Sentry are mocked.
import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Queue, UnrecoverableError, Worker } from "bullmq";

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
      "SELECT create_hypertable('respiratory_logs', 'measured_at', if_not_exists => TRUE);",
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

const glucoseBody = (clientUuid: string, valueMgDl: number, measuredAt = new Date()) => ({
  clientUuid,
  valueMgDl,
  readingType: "fasting",
  context: "normal",
  source: "manual",
  measuredAt: measuredAt.toISOString(),
  version: 1,
});

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

/** Makes every `add` to the critical-alert queue behave like a Redis outage. */
const breakCriticalQueue = (mode: "reject" | "hang", alsoBreak: readonly string[] = []): void => {
  // Re-bound with .apply below, so the unbound reference is safe.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { add } = Queue.prototype;
  vi.spyOn(Queue.prototype, "add").mockImplementation(function (this: Queue, ...args) {
    if (this.name === criticalQueueName || alsoBreak.includes(this.name)) {
      return mode === "reject"
        ? Promise.reject(new Error("ECONNREFUSED redis"))
        : new Promise(() => undefined);
    }
    return add.apply(this, args);
  });
};

const waitFor = async (check: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("critical alert hand-off survives a queue failure (audit P5)", () => {
  it("enqueue rejects → request still succeeds and the alert is dispatched in-process", async () => {
    const seed = await seedPatient();
    breakCriticalQueue("reject");

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(glucoseBody(randomUUID(), 48));

    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(true);
    await waitFor(() => sendExpoPushMock.mock.calls.length > 0);
    const pushed = sendExpoPushMock.mock.calls[0]![0] as { data: { readingId: string } }[];
    expect(pushed[0]!.data.readingId).toBe(res.body.data.reading.id);
    const stages = captureUnhandledMock.mock.calls.map((c) => (c[1] as { stage?: string }).stage);
    expect(stages).toContain("critical_alert_enqueue");
  });

  it("enqueue HANGS (Redis outage) → bounded, then dispatched in-process", async () => {
    const seed = await seedPatient();
    breakCriticalQueue("hang");

    const started = Date.now();
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(glucoseBody(randomUUID(), 330));

    expect(res.status).toBe(201);
    // 2s enqueue bound, not an unbounded hang.
    expect(Date.now() - started).toBeLessThan(8_000);
    await waitFor(() => sendExpoPushMock.mock.calls.length > 0);
  }, 20_000);

  it("client retries during the outage → the in-process dispatch is not repeated", async () => {
    const seed = await seedPatient();
    breakCriticalQueue("reject");
    const body = glucoseBody(randomUUID(), 45);

    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect(first.status).toBe(201);
    await waitFor(() => sendExpoPushMock.mock.calls.length > 0);

    const replay = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect([200, 201]).toContain(replay.status);
    await new Promise((r) => setTimeout(r, 300));
    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
  });
});

describe("in-process fallback that itself fails (safety review C1)", () => {
  it("retries in-process, then releases the slot so the next replay can deliver", async () => {
    const seed = await seedPatient();
    breakCriticalQueue("reject");
    // MSG91 throwing makes the whole dispatch reject (push/SMS helpers
    // normally swallow errors) — the in-process path must not give up for good.
    sendSmsBatchMock.mockRejectedValue(new Error("msg91 exploded"));
    const body = glucoseBody(randomUUID(), 46);

    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect(first.status).toBe(201);
    const stage = (c: unknown[]) => (c[1] as { stage?: string } | undefined)?.stage;
    await waitFor(() =>
      captureUnhandledMock.mock.calls.some((c) => stage(c) === "critical_alert_inline_dispatch"),
    );
    // First attempt + 2 in-process retries.
    expect(sendSmsBatchMock).toHaveBeenCalledTimes(3);

    sendSmsBatchMock.mockImplementation((messages: { phone: string }[]) =>
      Promise.resolve(messages.map((m) => ({ phone: m.phone, success: true }))),
    );
    const replay = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect([200, 201]).toContain(replay.status);
    await waitFor(() => sendSmsBatchMock.mock.calls.length > 3);
    expect(sendSmsBatchMock.mock.calls[3]![0]).toEqual([
      expect.objectContaining({ phone: seed.contactPhone }),
    ]);
  });
});

describe("escalation scheduling failure after the sends (P5 review N1)", () => {
  it("does not re-send the alert or report the dispatch as failed", async () => {
    const seed = await seedPatient();
    // Redis rejecting (not hanging) breaks BOTH the hand-off and the SOS
    // escalation schedule that runs after push + SMS went out.
    breakCriticalQueue("reject", ["critical-bypass-auto-escalate"]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(glucoseBody(randomUUID(), 47));
    expect(res.status).toBe(201);

    const stage = (c: unknown[]) => (c[1] as { stage?: string } | undefined)?.stage;
    await waitFor(() =>
      captureUnhandledMock.mock.calls.some(
        (c) => stage(c) === "critical_alert_escalation_schedule",
      ),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(sendSmsBatchMock).toHaveBeenCalledTimes(1);
    expect(
      captureUnhandledMock.mock.calls.some((c) => stage(c) === "critical_alert_inline_dispatch"),
    ).toBe(false);
  });
});

describe("a replay re-ensures a missing dispatch (audit P5)", () => {
  it("critical reading saved but never handed off → replay enqueues exactly one job", async () => {
    const seed = await seedPatient();
    const clientUuid = randomUUID();
    // The original request died between saving the row and the hand-off.
    const reading = await prisma.glucoseReading.create({
      data: {
        clientUuid,
        userId: seed.patientId,
        valueMgDl: 52,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date(),
        streakCreditedTo: new Date(),
        version: 1,
      },
    });
    expect(await criticalJobsFor(reading.id)).toHaveLength(0);

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post("/api/v1/readings/glucose")
        .set("Authorization", `Bearer ${seed.token}`)
        .send({ ...glucoseBody(clientUuid, 52), measuredAt: reading.measuredAt.toISOString() });
      expect([200, 201]).toContain(res.status);
      expect(res.body.data.critical.withinCooldown).toBe(false);
    }

    const jobs = await criticalJobsFor(reading.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`critical-glucose-${reading.id}-v1`);
  });

  it("normal save then replay → still one job, and the replay reports no cooldown", async () => {
    const seed = await seedPatient();
    const body = glucoseBody(randomUUID(), 40);

    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect(first.status).toBe(201);
    const replay = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);

    // Previously the replay read its own critical_warn as a prior alert.
    expect(replay.body.data.critical.withinCooldown).toBe(false);
    expect(await criticalJobsFor(first.body.data.reading.id)).toHaveLength(1);
  });

  it("reading that was inside the cooldown → replay does NOT dispatch", async () => {
    const seed = await seedPatient();
    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(glucoseBody(randomUUID(), 44));
    expect(first.body.data.critical.withinCooldown).toBe(false);

    const secondBody = glucoseBody(randomUUID(), 42);
    const second = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(secondBody);
    expect(second.body.data.critical.withinCooldown).toBe(true);

    const replay = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(secondBody);
    expect(replay.body.data.critical.withinCooldown).toBe(true);
    expect(await criticalJobsFor(second.body.data.reading.id)).toHaveLength(0);
  });

  it("stale critical reading (saved over 30 min ago) → replay does NOT re-alert", async () => {
    const seed = await seedPatient();
    const clientUuid = randomUUID();
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const reading = await prisma.glucoseReading.create({
      data: {
        clientUuid,
        userId: seed.patientId,
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: twoHoursAgo,
        streakCreditedTo: twoHoursAgo,
        updatedAt: twoHoursAgo,
        version: 1,
      },
    });

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ ...glucoseBody(clientUuid, 50), measuredAt: twoHoursAgo.toISOString() });
    expect([200, 201]).toContain(res.status);
    expect(await criticalJobsFor(reading.id)).toHaveLength(0);
  });

  it("cardiac: critical log saved but never handed off → replay enqueues one job", async () => {
    const seed = await seedPatient();
    const clientUuid = randomUUID();
    const log = await prisma.cardiacLog.create({
      data: {
        clientUuid,
        userId: seed.patientId,
        heartRate: 172,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date(),
        version: 1,
      },
    });

    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({
        clientUuid,
        heartRate: 172,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: log.measuredAt.toISOString(),
        version: 1,
      });
    expect([200, 201]).toContain(res.status);

    const jobs = await criticalJobsFor(log.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`critical-cardiac-${log.id}-v1`);
  });
});

describe("multi-category replays (safety review W4 + coverage)", () => {
  const cardiacBody = (clientUuid: string, measuredAt: Date) => ({
    clientUuid,
    heartRate: 175,
    rhythmStatus: "regular",
    chestPain: false,
    exerciseTolerance: "normal",
    source: "manual",
    measuredAt: measuredAt.toISOString(),
    version: 1,
  });

  it("cardiac: a reading the cooldown suppressed is not re-alerted on replay", async () => {
    const seed = await seedPatient();
    const first = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(cardiacBody(randomUUID(), new Date()));
    expect(first.body.data.critical.withinCooldown).toBe(false);

    const secondBody = cardiacBody(randomUUID(), new Date());
    const second = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(secondBody);
    expect(second.body.data.critical.withinCooldown).toBe(true);

    await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(secondBody);
    expect(await criticalJobsFor(second.body.data.reading.id)).toHaveLength(0);

    // The stamp outlives the 30-min window, so a replay up to 30 min after
    // the save still sees what suppressed it.
    const { redis } = await import("../../src/shared/redis.js");
    expect(await redis.ttl(`critical_bypass:cooldown:cardiac:${seed.patientId}`)).toBeGreaterThan(
      30 * 60,
    );
  });

  it("respiratory: critical log saved but never handed off → replay enqueues one job", async () => {
    const seed = await seedPatient();
    const clientUuid = randomUUID();
    const log = await prisma.respiratoryLog.create({
      data: {
        clientUuid,
        userId: seed.patientId,
        inhalerUsed: true,
        symptomSeverity: "severe",
        source: "manual",
        measuredAt: new Date(),
        version: 1,
      },
    });

    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({
        clientUuid,
        inhalerUsed: true,
        symptomSeverity: "severe",
        source: "manual",
        measuredAt: log.measuredAt.toISOString(),
        version: 1,
      });
    expect([200, 201]).toContain(res.status);
    const jobs = await criticalJobsFor(log.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`critical-respiratory-${log.id}-v1`);
  });
});

// Runs last: the throwaway worker below fails whatever is waiting.
describe("a job that already failed for good (safety review W3 / N2)", () => {
  /** Fails the job with `jobId` for good (no retries), then stops the worker. */
  const failForGood = async (probe: Queue, conn: { duplicate: () => unknown }, jobId: string) => {
    const failing = new Worker(
      criticalQueueName,
      () => Promise.reject(new UnrecoverableError("db down")),
      { connection: conn.duplicate() as never },
    );
    const deadline = Date.now() + 10_000;
    while ((await (await probe.getJob(jobId))!.getState()) !== "failed") {
      if (Date.now() > deadline) throw new Error("job never failed");
      await new Promise((r) => setTimeout(r, 50));
    }
    await failing.close();
  };

  it("glucose: is revived by a replay instead of blocking it for a day", async () => {
    const seed = await seedPatient();
    const clientUuid = randomUUID();
    const reading = await prisma.glucoseReading.create({
      data: {
        clientUuid,
        userId: seed.patientId,
        valueMgDl: 41,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date(),
        streakCreditedTo: new Date(),
        version: 1,
      },
    });
    const jobId = `critical-glucose-${reading.id}-v1`;

    const { Redis } = await import("ioredis");
    const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const probe = new Queue(criticalQueueName, { connection: conn });
    await probe.add("dispatch", { readingId: reading.id, userId: seed.patientId }, { jobId });
    await failForGood(probe, conn, jobId);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ ...glucoseBody(clientUuid, 41), measuredAt: reading.measuredAt.toISOString() });
    expect([200, 201]).toContain(res.status);

    expect(await (await probe.getJob(jobId))!.getState()).not.toBe("failed");
    await probe.close();
    await conn.quit();
  }, 30_000);

  it("cardiac: its own cooldown stamp doesn't stop the replay reviving it", async () => {
    const seed = await seedPatient();
    const body = {
      clientUuid: randomUUID(),
      heartRate: 178,
      rhythmStatus: "regular",
      chestPain: false,
      exerciseTolerance: "normal",
      source: "manual",
      measuredAt: new Date().toISOString(),
      version: 1,
    };
    // Normal dispatch: job enqueued AND the cardiac cooldown stamped.
    const first = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect(first.body.data.critical.withinCooldown).toBe(false);
    const jobId = `critical-cardiac-${first.body.data.reading.id}-v1`;

    const { Redis } = await import("ioredis");
    const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const probe = new Queue(criticalQueueName, { connection: conn });
    await failForGood(probe, conn, jobId);

    const replay = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${seed.token}`)
      .send(body);
    expect([200, 201]).toContain(replay.status);

    expect(await (await probe.getJob(jobId))!.getState()).not.toBe("failed");
    await probe.close();
    await conn.quit();
  }, 30_000);
});
