// Phase 4 §H "Gate to Week 19": meal/food search returns < 200ms p95.
//
// Seeds the real 216-row canonical dataset (via the exported
// `seedFoodItems`), then fires many DISTINCT prefix queries through the
// live HTTP endpoint and asserts the p95 latency is under the gate. The
// queries are distinct so each one MISSES the Redis cache — this
// measures the DB-backed query path (the worst case the gate cares
// about), not the warm-cache fast path. A generous margin keeps it
// non-flaky on shared CI runners while still proving the gate.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";

const runPrisma = (args: string[]): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed (status ${result.status})`);
  }
};

const P95_BUDGET_MS = 200;

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let accessToken: string;
let seededTotal = 0;
const TEST_PHONE = "+919812345691";

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

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const seedModule = await import("../../prisma/seed-food-items.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  const prisma = dbModule.prisma;

  // Raise the per-minute ceiling so the bulk latency sample isn't cut
  // short by the 100/min default rate limit — we're measuring search
  // latency, not throttling.
  await flagsModule.setFlag("rate_limit.default.free", 100_000, "test");
  flagsModule.__resetFlagCache();

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Perf Tester",
      age: 62,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  const result = await seedModule.seedFoodItems(prisma);
  seededTotal = result.total;
}, 180_000);

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

describe("GET /api/v1/foods/search — §H p95 latency gate", () => {
  it("seeds ≥ 200 rows (the gate's row-count precondition)", () => {
    expect(seededTotal).toBeGreaterThanOrEqual(200);
  });

  it("serves cache-cold prefix searches under 200ms p95", async () => {
    // Distinct prefixes → every request misses the cache and hits the DB.
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const queries: string[] = [];
    for (const a of letters) {
      queries.push(a);
      for (const b of letters) queries.push(a + b);
    }

    // Warm up the process (JIT, pool, first-query planning) — excluded
    // from the measured sample so we report steady-state latency.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .get(`/api/v1/foods/search?q=${queries[i]}`)
        .set("Authorization", `Bearer ${accessToken}`);
    }

    const sample = queries.slice(10, 210); // 200 distinct measured calls
    const timings: number[] = [];
    for (const q of sample) {
      const start = performance.now();
      const res = await request(app)
        .get(`/api/v1/foods/search?q=${q}`)
        .set("Authorization", `Bearer ${accessToken}`);
      timings.push(performance.now() - start);
      expect(res.status).toBe(200);
    }

    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? timings[timings.length - 1]!;
    const p50 = timings[Math.floor(timings.length * 0.5)]!;
    // Surfaced in the test runner output so the gate number is on record.
    // eslint-disable-next-line no-console
    console.log(
      `[§H foods/search] n=${timings.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms budget=${P95_BUDGET_MS}ms`,
    );
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });
});
