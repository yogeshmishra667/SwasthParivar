// Phase 3 Feature C — SILENT_GUARDIAN_ANALYZE compute integration tests
// (C-3 slice). Drives the processor directly (the same pattern
// critical-bypass-chain.test.ts uses) against a real Postgres + Redis.
//
// Covers: the `silent_guardian_enabled` flag gate, med-adherence signal
// → orange alert, the worsening-trend data_anomaly signal, a healthy
// patient producing nothing, a patient with no guardian never being
// analysed, and the daily creation-guard against duplicate alerts.
//
// Dispatch is a later slice — every GuardianAlert here is created in
// shadow mode (sentVia empty, never pushed).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { SilentGuardianAnalyzeJob } from "../../src/workers/silent-guardian-analyze.processor.js";

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
let prisma: any;
let runAnalyze: () => Promise<void>;
let setFlag: (key: string, value: boolean, by: string) => Promise<unknown>;
let resetFlagCache: () => void;

let guardianId: string;
let patientMissedId: string;
let patientHealthyId: string;
let patientNoGuardianId: string;
let patientTrendId: string;

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.now();

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

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const processorModule = await import("../../src/workers/silent-guardian-analyze.processor.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;

  const run = processorModule.processSilentGuardianAnalyze;
  runAnalyze = () => run({ data: { tick: true } } as Job<SilentGuardianAnalyzeJob>);

  const household = await prisma.household.create({ data: {} });
  const mkUser = (name: string, phone: string): Promise<{ id: string }> =>
    prisma.user.create({
      data: {
        phone,
        name,
        age: 60,
        householdId: household.id,
        conditions: ["diabetes"],
        onboardingComplete: true,
      },
    });

  const guardian = await mkUser("Suresh", "+919830000001");
  const patientMissed = await mkUser("Ramesh", "+919830000002");
  const patientHealthy = await mkUser("Sushila", "+919830000003");
  const patientNoGuardian = await mkUser("Mohan", "+919830000004");
  const patientTrend = await mkUser("Anita", "+919830000005");
  guardianId = guardian.id;
  patientMissedId = patientMissed.id;
  patientHealthyId = patientHealthy.id;
  patientNoGuardianId = patientNoGuardian.id;
  patientTrendId = patientTrend.id;

  // Accepted guardian links — every patient EXCEPT patientNoGuardian.
  for (const patientId of [patientMissedId, patientHealthyId, patientTrendId]) {
    await prisma.familyLink.create({
      data: { patientId, guardianId, status: "accepted", acceptedAt: new Date() },
    });
  }

  // patientMissed — a schedule with 3 missed doses in the last 7 days.
  const missedSchedule = await prisma.medicationSchedule.create({
    data: { userId: patientMissedId, medicineName: "Metformin", timeSlots: ["08:00"] },
  });
  for (let i = 1; i <= 3; i++) {
    await prisma.medicationLog.create({
      data: {
        scheduleId: missedSchedule.id,
        userId: patientMissedId,
        status: i === 3 ? "skipped" : "missed_no_response",
        scheduledFor: new Date(NOW - i * DAY - HOUR),
      },
    });
  }

  // patientHealthy — a schedule with 3 doses, all taken.
  const healthySchedule = await prisma.medicationSchedule.create({
    data: { userId: patientHealthyId, medicineName: "Metformin", timeSlots: ["08:00"] },
  });
  for (let i = 1; i <= 3; i++) {
    await prisma.medicationLog.create({
      data: {
        scheduleId: healthySchedule.id,
        userId: patientHealthyId,
        status: "taken",
        scheduledFor: new Date(NOW - i * DAY - HOUR),
      },
    });
  }

  // patientNoGuardian — also missing doses, but no guardian link, so the
  // analyzer must never touch them.
  const orphanSchedule = await prisma.medicationSchedule.create({
    data: { userId: patientNoGuardianId, medicineName: "Metformin", timeSlots: ["08:00"] },
  });
  for (let i = 1; i <= 3; i++) {
    await prisma.medicationLog.create({
      data: {
        scheduleId: orphanSchedule.id,
        userId: patientNoGuardianId,
        status: "missed_no_response",
        scheduledFor: new Date(NOW - i * DAY - HOUR),
      },
    });
  }

  // patientTrend — a clean rising fasting-glucose line across 12 days.
  const trendDaysAgo = [12, 10, 8, 6, 4, 2, 0.5];
  const trendValues = [115, 125, 135, 145, 155, 165, 175];
  for (let i = 0; i < trendDaysAgo.length; i++) {
    const measuredAt = new Date(NOW - trendDaysAgo[i]! * DAY);
    await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId: patientTrendId,
        valueMgDl: trendValues[i]!,
        readingType: "fasting",
        source: "manual",
        measuredAt,
        streakCreditedTo: new Date(measuredAt.toISOString().slice(0, 10)),
      },
    });
  }
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

describe("SILENT_GUARDIAN_ANALYZE", () => {
  it("does nothing while silent_guardian_enabled is off", async () => {
    await runAnalyze();
    expect(await prisma.silentGuardianSignal.count()).toBe(0);
    expect(await prisma.guardianAlert.count()).toBe(0);
  });

  it("scores a missed-medication signal and fires an orange alert once enabled", async () => {
    await setFlag("silent_guardian_enabled", true, "test");
    resetFlagCache();
    await runAnalyze();

    const signals = await prisma.silentGuardianSignal.findMany({
      where: { userId: patientMissedId },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].signalSource).toBe("med_adherence");
    expect(signals[0].riskContribution).toBeGreaterThanOrEqual(61);

    const alerts = await prisma.guardianAlert.findMany({ where: { patientId: patientMissedId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].guardianId).toBe(guardianId);
    expect(alerts[0].severity).toBe("orange");
    expect(alerts[0].alertType).toBe("med_adherence");
    expect(alerts[0].signalIds).toContain(signals[0].id);
    // Shadow mode — created but never dispatched.
    expect(alerts[0].sentVia).toEqual([]);
    expect(alerts[0].pushDelivered).toBe(false);
  });

  it("leaves a healthy, adherent patient with no signal and no alert", async () => {
    expect(await prisma.silentGuardianSignal.count({ where: { userId: patientHealthyId } })).toBe(
      0,
    );
    expect(await prisma.guardianAlert.count({ where: { patientId: patientHealthyId } })).toBe(0);
  });

  it("never analyses a patient who has no accepted guardian link", async () => {
    expect(
      await prisma.silentGuardianSignal.count({ where: { userId: patientNoGuardianId } }),
    ).toBe(0);
    expect(await prisma.guardianAlert.count({ where: { patientId: patientNoGuardianId } })).toBe(0);
  });

  it("detects a worsening glucose trend as a data_anomaly signal + alert", async () => {
    const signals = await prisma.silentGuardianSignal.findMany({
      where: { userId: patientTrendId },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].signalSource).toBe("data_anomaly");

    const alerts = await prisma.guardianAlert.findMany({ where: { patientId: patientTrendId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertType).toBe("trend_concern");
  });

  it("does not create a duplicate alert on the next daily run (creation-guard)", async () => {
    await runAnalyze();
    // A fresh signal is scored each run, but the unread orange alert
    // from the previous run suppresses a second alert row.
    expect(await prisma.guardianAlert.count({ where: { patientId: patientMissedId } })).toBe(1);
  });
});
