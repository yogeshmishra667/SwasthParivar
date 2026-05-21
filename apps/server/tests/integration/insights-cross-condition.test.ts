// Phase 3 integration tests — B.5 cross-condition + meal-correlation detectors.
//
// Tests the full flow: seed glucose + BP data → invoke the
// ANALYZE_READING processor directly → verify an InsightEvent row is
// written when the fixture has enough signal, and nothing is written
// when the data is too sparse.
//
// Imports the processor directly (no BullMQ listener). Real Postgres +
// Redis via Testcontainers.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { prisma as PrismaInstance } from "../../src/shared/database.js";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";
import type {
  processAnalyzeReading as ProcessorFn,
  AnalyzeReadingJob,
} from "../../src/workers/analyze-reading.processor.js";

const DAY_MS = 86_400_000;

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
let prisma: typeof PrismaInstance;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let processAnalyzeReading: typeof ProcessorFn;

let userId: string;

const makeJob = (payload: AnalyzeReadingJob): Job<AnalyzeReadingJob> =>
  ({
    id: "test",
    data: payload,
  }) as unknown as Job<AnalyzeReadingJob>;

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
      "SELECT create_hypertable('insight_events', 'created_at', if_not_exists => TRUE);",
  });

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const processorModule = await import("../../src/workers/analyze-reading.processor.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  processAnalyzeReading = processorModule.processAnalyzeReading;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: "+919812345701",
      name: "Cross Tester",
      age: 65,
      householdId: household.id,
      conditions: ["diabetes", "hypertension"],
      onboardingComplete: true,
    },
  });
  userId = user.id;
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

beforeEach(async () => {
  resetFlagCache();
  // Ships with both detectors OFF — reset to default state.
  await setFlag("cross_condition_detector_enabled", false, "test");
  await setFlag("correlation_detector_enabled", false, "test");
  await prisma.insightEvent.deleteMany({ where: { userId } });
  await prisma.glucoseReading.deleteMany({ where: { userId } });
  await prisma.bPReading.deleteMany({ where: { userId } });
  await prisma.mealLog.deleteMany({ where: { userId } });
});

// Seeds 35 days of paired glucose + BP: high-BP days have glucose ~180,
// normal-BP days have glucose ~120, giving a strong detectable signal.
const seedCrossConditionFixture = async (): Promise<string> => {
  const now = new Date();
  const glucoseRows: any[] = [];
  const bpRows: any[] = [];

  for (let d = 0; d < 35; d++) {
    const dayMs = now.getTime() - d * DAY_MS;
    const isHighBP = d % 3 === 0; // ~12 high-BP days, ~23 normal

    bpRows.push({
      id: randomUUID(),
      clientUuid: randomUUID(),
      userId,
      systolic: isHighBP ? 148 : 118,
      diastolic: isHighBP ? 95 : 75,
      context: "normal",
      source: "manual",
      // Same instant as the day's glucose row. The detector pairs
      // glucose↔BP by UTC calendar day; an offset risks the BP row
      // landing on the previous UTC day when the suite runs near
      // midnight UTC, which would unpair it from its glucose reading.
      measuredAt: new Date(dayMs),
      version: 1,
    });

    glucoseRows.push({
      id: randomUUID(),
      clientUuid: randomUUID(),
      userId,
      valueMgDl: isHighBP
        ? 180 + Math.round(Math.random() * 20)
        : 120 + Math.round(Math.random() * 15),
      readingType: "fasting",
      context: "normal",
      source: "manual",
      measuredAt: new Date(dayMs),
      streakCreditedTo: new Date(new Date(dayMs).toISOString().slice(0, 10)),
      version: 1,
    });
  }

  await prisma.bPReading.createMany({ data: bpRows });
  await prisma.glucoseReading.createMany({ data: glucoseRows });
  // Return the ID of the most-recent glucose reading (today's row).
  return glucoseRows[0].id;
};

describe("cross_condition_detector_enabled = OFF (default)", () => {
  it("no cross-condition InsightEvent written even with sufficient data", async () => {
    const readingId = await seedCrossConditionFixture();
    // Flag stays false (default).
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "fasting" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "cross_condition" },
    });
    expect(events).toHaveLength(0);
  });
});

describe("cross_condition_detector_enabled = ON", () => {
  it("writes a cross_condition InsightEvent when fixture has enough paired signal", async () => {
    await setFlag("cross_condition_detector_enabled", true, "test");
    resetFlagCache();

    const readingId = await seedCrossConditionFixture();
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "fasting" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "cross_condition" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0]!;
    expect(["info", "warn", "critical"]).toContain(first.severityLevel);
    expect(first.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("writes no InsightEvent when BP data is absent (< 30 paired days)", async () => {
    await setFlag("cross_condition_detector_enabled", true, "test");
    resetFlagCache();

    // Only seed a glucose reading — no BP rows → detector should return null.
    const reading = await prisma.glucoseReading.create({
      data: {
        id: randomUUID(),
        clientUuid: randomUUID(),
        userId,
        valueMgDl: 140,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date(),
        streakCreditedTo: new Date(new Date().toISOString().slice(0, 10)),
        version: 1,
      },
    });
    await processAnalyzeReading(makeJob({ readingId: reading.id, userId, readingType: "fasting" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "cross_condition" },
    });
    expect(events).toHaveLength(0);
  });

  it("does not append a duplicate cross_condition row on a second analyze run", async () => {
    await setFlag("cross_condition_detector_enabled", true, "test");
    resetFlagCache();

    const readingId = await seedCrossConditionFixture();
    // cross_condition is window-level — both runs recompute an identical
    // result. The second must be deduped against the first run's row.
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "fasting" }));
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "fasting" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "cross_condition" },
    });
    expect(events).toHaveLength(1);
  });
});

// Seeds 21 post_meal readings spaced 8h apart across the 7-day window
// (≈6.7-day span). The 5 most-recent follow a heavy_fried meal (glucose
// ~270); the other 16 follow a light meal (~110). The heavy_fried bucket
// clears the 5-instance floor and runs far above the post_meal baseline
// → a high-confidence meal_correlation insight. Pure ms arithmetic — no
// dependence on the wall-clock time of day.
const seedMealCorrelationFixture = async (): Promise<string> => {
  const now = new Date();
  const glucoseRows: any[] = [];
  const mealRows: any[] = [];
  const SPACING_MS = 8 * 60 * 60 * 1000;

  for (let i = 0; i < 21; i++) {
    const readingMs = now.getTime() - i * SPACING_MS;
    const heavy = i < 5;

    mealRows.push({
      id: randomUUID(),
      clientUuid: randomUUID(),
      userId,
      mealType: "lunch",
      mealCategory: heavy ? "heavy_fried" : "light",
      loggedAt: new Date(readingMs - 60 * 60 * 1000), // 1h before the reading
      version: 1,
    });

    glucoseRows.push({
      id: randomUUID(),
      clientUuid: randomUUID(),
      userId,
      valueMgDl: heavy ? 265 + Math.round(Math.random() * 10) : 106 + Math.round(Math.random() * 8),
      readingType: "post_meal",
      context: "normal",
      source: "manual",
      measuredAt: new Date(readingMs),
      streakCreditedTo: new Date(new Date(readingMs).toISOString().slice(0, 10)),
      version: 1,
    });
  }

  await prisma.mealLog.createMany({ data: mealRows });
  await prisma.glucoseReading.createMany({ data: glucoseRows });
  return glucoseRows[0].id;
};

describe("correlation_detector_enabled = ON", () => {
  it("writes exactly one meal_correlation InsightEvent — Phase 2 and Phase 3 detectors never both fire", async () => {
    await setFlag("correlation_detector_enabled", true, "test");
    resetFlagCache();

    const readingId = await seedMealCorrelationFixture();
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "post_meal" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "meal_correlation" },
    });
    // Pre-fix this was 2: the Phase 2 detectMealCorrelation ran
    // unconditionally alongside the flag-gated Phase 3 detector, both
    // emitting a `meal_correlation` row. The flag now switches between
    // them rather than adding the Phase 3 detector on top.
    expect(events).toHaveLength(1);
    expect(events[0]!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not append a duplicate meal_correlation row on a second analyze run", async () => {
    await setFlag("correlation_detector_enabled", true, "test");
    resetFlagCache();

    const readingId = await seedMealCorrelationFixture();
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "post_meal" }));
    await processAnalyzeReading(makeJob({ readingId, userId, readingType: "post_meal" }));

    const events = await prisma.insightEvent.findMany({
      where: { userId, patternType: "meal_correlation" },
    });
    expect(events).toHaveLength(1);
  });
});
