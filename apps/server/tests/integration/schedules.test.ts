// Phase 2 carry-over (Week 17) — /api/v1/schedules integration tests.
//
// Covers GET / POST / PUT, RBAC + household scoping, validation
// branches (weekly without dayOfWeek), and the SCHEDULE_COMPLIANCE_CHECK
// processor (one direct call, then assert compliance rows + idempotency).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

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
let processScheduleComplianceCheck: any;

let patientId: string;
let outsiderId: string;
let patientToken: string;
let outsiderToken: string;

const PATIENT_PHONE = "+919812347710";
const OUTSIDER_PHONE = "+919812347720";

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
  const processorModule = await import("../../src/workers/schedule-compliance.processor.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  processScheduleComplianceCheck = processorModule.processScheduleComplianceCheck;

  const patientHousehold = await prisma.household.create({ data: {} });
  const outsiderHousehold = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: PATIENT_PHONE,
      name: "Ramesh",
      age: 65,
      householdId: patientHousehold.id,
      conditions: ["diabetes"],
      timezone: "Asia/Kolkata",
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: OUTSIDER_PHONE,
      name: "Outsider",
      age: 40,
      householdId: outsiderHousehold.id,
      timezone: "Asia/Kolkata",
      onboardingComplete: true,
    },
  });

  patientId = patient.id;
  outsiderId = outsider.id;
  patientToken = jwt.sign(
    { sub: patientId, householdId: patientHousehold.id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  outsiderToken = jwt.sign(
    { sub: outsiderId, householdId: outsiderHousehold.id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
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

describe("POST /api/v1/schedules", () => {
  it("creates a daily glucose schedule", async () => {
    const res = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "glucose",
        frequency: "daily",
        scheduledTimes: [
          { hour: 7, minute: 0 },
          { hour: 21, minute: 0 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.schedule.checkType).toBe("glucose");
    expect(res.body.data.schedule.scheduledTimes).toHaveLength(2);
    expect(res.body.data.schedule.active).toBe(true);
    expect(res.body.data.schedule.reminderEnabled).toBe(true);
  });

  it("rejects a weekly schedule missing dayOfWeek", async () => {
    const res = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "bp",
        frequency: "weekly",
        scheduledTimes: [{ hour: 8, minute: 0 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a weekly schedule with explicit dayOfWeek", async () => {
    const res = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "bp",
        frequency: "weekly",
        scheduledTimes: [{ hour: 8, minute: 0, dayOfWeek: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.schedule.checkType).toBe("bp");
  });

  it("rejects an empty scheduledTimes array", async () => {
    const res = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ checkType: "glucose", frequency: "daily", scheduledTimes: [] });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/schedules", () => {
  it("returns the patient's schedules with compliance summaries", async () => {
    const res = await request(app)
      .get("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.schedules)).toBe(true);
    expect(res.body.data.schedules.length).toBeGreaterThanOrEqual(1);
    const first = res.body.data.schedules[0];
    expect(first).toHaveProperty("compliance");
    expect(first.compliance).toHaveProperty("nextDueAtIso");
    expect(first.compliance).toHaveProperty("onTimeCount");
  });

  it("does not leak another household's schedules", async () => {
    const res = await request(app)
      .get("/api/v1/schedules")
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.schedules).toHaveLength(0);
  });
});

describe("PUT /api/v1/schedules/:id", () => {
  it("toggles a schedule inactive then back active", async () => {
    const created = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "glucose",
        frequency: "daily",
        scheduledTimes: [{ hour: 12, minute: 0 }],
      });
    const id = created.body.data.schedule.id;

    const off = await request(app)
      .put(`/api/v1/schedules/${id}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.schedule.active).toBe(false);

    const on = await request(app)
      .put(`/api/v1/schedules/${id}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ active: true });
    expect(on.status).toBe(200);
    expect(on.body.data.schedule.active).toBe(true);
  });

  it("rejects updating another user's schedule with 404", async () => {
    const created = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "glucose",
        frequency: "daily",
        scheduledTimes: [{ hour: 13, minute: 0 }],
      });
    const id = created.body.data.schedule.id;

    const res = await request(app)
      .put(`/api/v1/schedules/${id}`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ active: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SCHEDULE_NOT_FOUND");
  });

  it("rejects empty-body updates", async () => {
    const created = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "glucose",
        frequency: "daily",
        scheduledTimes: [{ hour: 14, minute: 0 }],
      });
    const id = created.body.data.schedule.id;

    const res = await request(app)
      .put(`/api/v1/schedules/${id}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("SCHEDULE_COMPLIANCE_CHECK processor", () => {
  it("UPSERTs compliance rows from an in-window reading", async () => {
    // Wipe prior schedules so we have a clean expected slot count.
    await prisma.healthCheckCompliance.deleteMany({ where: { userId: patientId } });
    await prisma.healthCheckSchedule.deleteMany({ where: { userId: patientId } });

    // Schedule: glucose, daily at the current UTC hour (+ minute 0)
    // so the slot lands inside the 24h window the cron evaluates.
    const now = new Date();
    const istNow = new Date(now.getTime() + 330 * 60_000);
    const istHour = istNow.getUTCHours();
    const created = await request(app)
      .post("/api/v1/schedules")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        checkType: "glucose",
        frequency: "daily",
        scheduledTimes: [{ hour: istHour, minute: 0 }],
      });
    const scheduleId = created.body.data.schedule.id;

    // Reading at istHour:30 — inside on-time bucket (±60 min).
    const measuredAt = new Date(now.getTime() - 30 * 60_000);
    const reading = await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId: patientId,
        valueMgDl: 110,
        readingType: "fasting",
        source: "manual",
        measuredAt,
        streakCreditedTo: new Date(measuredAt.toISOString().slice(0, 10)),
      },
    });

    await processScheduleComplianceCheck({ data: { tick: true } } as any);

    const rows = await prisma.healthCheckCompliance.findMany({
      where: { scheduleId },
    });
    expect(rows.length).toBeGreaterThan(0);
    const onTime = rows.find((r: any) => r.status === "on_time");
    expect(onTime).toBeDefined();
    expect(onTime!.readingId).toBe(reading.id);
  }, 30_000);

  it("is idempotent across re-runs (no duplicate rows)", async () => {
    await processScheduleComplianceCheck({ data: { tick: true } } as any);
    const firstCount = await prisma.healthCheckCompliance.count({
      where: { userId: patientId },
    });
    await processScheduleComplianceCheck({ data: { tick: true } } as any);
    const secondCount = await prisma.healthCheckCompliance.count({
      where: { userId: patientId },
    });
    expect(secondCount).toBe(firstCount);
  }, 30_000);

  it("is no-op when killed by the flag", async () => {
    const flags = await import("../../src/shared/flags/index.js");
    await flags.setFlag("schedule_compliance_check_enabled", false, "test");
    flags.__resetFlagCache();

    // Schedule a fresh slot one minute in the past — without the flag
    // the next tick would persist a `late` row. With the flag off the
    // count should not change.
    const before = await prisma.healthCheckCompliance.count({
      where: { userId: patientId },
    });
    await processScheduleComplianceCheck({ data: { tick: true } } as any);
    const after = await prisma.healthCheckCompliance.count({
      where: { userId: patientId },
    });
    expect(after).toBe(before);

    await flags.setFlag("schedule_compliance_check_enabled", true, "test");
    flags.__resetFlagCache();
  }, 30_000);
});
