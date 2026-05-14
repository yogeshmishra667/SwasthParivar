import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock the two external notification surfaces at module level. vi.mock is
// hoisted to the top of the file; we use vi.hoisted to make the spy
// instances exist BEFORE the mock factories evaluate (otherwise the
// factory captures undefined and `sendExpoPush()` returns undefined at
// runtime).
const { sendExpoPushMock, sendSmsBatchMock } = vi.hoisted(() => ({
  sendExpoPushMock: vi.fn(),
  sendSmsBatchMock: vi.fn(),
}));

vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: sendExpoPushMock,
}));
vi.mock("../../src/shared/notifications/msg91-sms.js", () => ({
  sendSmsBatch: sendSmsBatchMock,
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
let processCriticalAlert: (job: { data: any; id?: string }) => Promise<void>;

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
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  // Import the PROCESSOR module (no side effects) — the companion
  // .worker.ts would start a real BullMQ listener that races with the
  // test's direct processor invocation and double-consumes mock calls.
  const processorModule = await import("../../src/workers/critical-alert.processor.js");

  app = appModule.buildApp();
  prisma = dbModule.prisma;
  processCriticalAlert = processorModule.processCriticalAlert as typeof processCriticalAlert;
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
});

interface TestFixture {
  patientId: string;
  patientToken: string;
  guardianId: string;
  guardianContactId: string;
}

const seedPatientWithGuardian = async (): Promise<TestFixture> => {
  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Ramesh Test",
      age: 65,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  const guardian = await prisma.user.create({
    data: {
      phone: `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Priya Test",
      age: 35,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  // Emergency contact whose phone matches the guardian user — the worker
  // resolves push tokens via this lookup.
  const contact = await prisma.emergencyContact.create({
    data: {
      userId: patient.id,
      name: "Priya Test",
      phone: guardian.phone,
      relationship: "daughter",
      priority: 1,
      isGuardian: true,
    },
  });
  await prisma.pushToken.create({
    data: {
      userId: guardian.id,
      token: `ExponentPushToken[${randomUUID()}]`,
      platform: "android",
    },
  });
  const token = jwt.sign({ sub: patient.id, householdId: household.id }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
  return {
    patientId: patient.id,
    patientToken: token,
    guardianId: guardian.id,
    guardianContactId: contact.id,
  };
};

const fetchEnqueuedJob = async (readingId: string): Promise<any> => {
  const queueModule = await import("../../src/shared/queue.js");
  const { Queue } = await import("bullmq");
  const { Redis } = await import("ioredis");
  const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const probeQueue = new Queue(queueModule.QUEUE_NAMES.CRITICAL_ALERT, { connection: conn });
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const jobs = await probeQueue.getJobs(["waiting", "active", "delayed", "completed"], 0, 100);
      const match = jobs.find((j: any) => j.data?.readingId === readingId);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  } finally {
    await probeQueue.close();
    await conn.quit();
  }
};

describe("Critical-bypass full chain (HTTP → service → queue → worker → push/SMS)", () => {
  it("low-glucose POST: push succeeds → SMS NOT triggered", async () => {
    const { patientId, patientToken } = await seedPatientWithGuardian();

    sendExpoPushMock.mockResolvedValueOnce([{ token: "stub", success: true }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 48,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(true);
    expect(res.body.data.critical.severity).toBe("low");

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();
    expect(job.data.userId).toBe(patientId);

    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    const pushArgs = sendExpoPushMock.mock.calls[0]![0] as {
      title: string;
      body: string;
      data: { type: string; severity: string };
    }[];
    expect(pushArgs.length).toBeGreaterThan(0);
    expect(pushArgs[0]!.title).toContain("Bahut Kam");
    expect(pushArgs[0]!.body).toContain("48");
    expect(pushArgs[0]!.data.type).toBe("critical_alert");
    expect(pushArgs[0]!.data.severity).toBe("low");

    expect(sendSmsBatchMock).not.toHaveBeenCalled();
  });

  it("high-glucose POST: push fails → SMS fallback triggered", async () => {
    const { patientId: _patientId, patientToken } = await seedPatientWithGuardian();

    sendExpoPushMock.mockResolvedValueOnce([
      { token: "stub", success: false, errorCode: "DeviceNotRegistered" },
    ]);
    sendSmsBatchMock.mockResolvedValueOnce([{ phone: "+91XXXX", success: true }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 330,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.severity).toBe("high");
    expect(res.body.data.critical.showFullscreenAlert).toBe(true);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();

    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    expect(sendSmsBatchMock).toHaveBeenCalledTimes(1);
    const smsArgs = sendSmsBatchMock.mock.calls[0]![0] as { phone: string; message: string }[];
    expect(smsArgs[0]!.message).toContain("BAHUT ZYADA");
    expect(smsArgs[0]!.message).toContain("330");
  });

  it("preserves requestId from HTTP request through queue payload", async () => {
    const { patientToken } = await seedPatientWithGuardian();
    sendExpoPushMock.mockResolvedValue([{ token: "stub", success: true }]);

    const reqId = `test-req-${randomUUID()}`;
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Request-Id", reqId)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();
    expect(job.data.requestId).toBe(reqId);
  });

  it("normal-range reading: NO queue job is enqueued and NO notifications fire", async () => {
    const { patientToken } = await seedPatientWithGuardian();

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 110,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);

    // Brief wait so a (wrongly-)enqueued job has a chance to land in Redis.
    await new Promise((r) => setTimeout(r, 300));
    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).toBeNull();
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    expect(sendSmsBatchMock).not.toHaveBeenCalled();
  });

  it("threshold boundary: 65 mg/dL is NOT critical, 64 mg/dL IS critical", async () => {
    // CLAUDE.md: "Thresholds HARDCODED. Not configurable. Medical safety."
    // This test exists so a future change to the threshold constants
    // breaks the test loudly rather than slipping through review.
    const { patientToken } = await seedPatientWithGuardian();

    const at65 = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 65,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(at65.body.data.critical.isCritical).toBe(false);

    const at64 = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 64,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(at64.body.data.critical.isCritical).toBe(true);
    expect(at64.body.data.critical.severity).toBe("low");
  });
});
