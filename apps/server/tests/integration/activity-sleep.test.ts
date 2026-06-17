// Integration tests use `any` for `app` / `prisma` bodies to match the
// existing convention in readings.test.ts / meals.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

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

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let redis: any;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let accessToken: string;
let userId: string;
const TEST_PHONE = "+919812345701";

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
  const redisModule = await import("../../src/shared/redis.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  redis = redisModule.redis;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Wearable Tester",
      age: 64,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  userId = user.id;
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}, 180_000);

afterAll(async () => {
  try {
    const dbModule = await import("../../src/shared/database.js");
    await dbModule.disconnectDatabase();
  } catch {
    /* ignore */
  }
  try {
    if (redis) await redis.quit();
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

const auth = (r: request.Test): request.Test => r.set("Authorization", `Bearer ${accessToken}`);

describe("wearables — feature flags off (default)", () => {
  it("POST /activity/daily → 503 ACTIVITY_DISABLED when flag off", async () => {
    const res = await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-01",
      steps: 4000,
      distanceMeters: 3000,
      activeMinutes: 30,
      source: "manual",
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ACTIVITY_DISABLED");
  });

  it("POST /sleep → 503 SLEEP_DISABLED when flag off", async () => {
    const res = await auth(request(app).post("/api/v1/sleep")).send({
      date: "2026-06-01",
      sleepStart: "2026-06-01T22:00:00.000Z",
      sleepEnd: "2026-06-02T06:00:00.000Z",
      durationMinutes: 480,
      quality: "good",
      source: "manual",
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SLEEP_DISABLED");
  });
});

describe("wearables — enabled", () => {
  beforeAll(async () => {
    await setFlag("activity_logging_enabled", true, "test");
    await setFlag("sleep_logging_enabled", true, "test");
    resetFlagCache();
  });

  it("rejects a payload with no source (400 — source is mandatory)", async () => {
    const res = await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-02",
      steps: 4000,
      distanceMeters: 3000,
      activeMinutes: 30,
    });
    expect(res.status).toBe(400);
  });

  it("stores a manual activity row", async () => {
    const res = await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-03",
      steps: 5000,
      distanceMeters: 3500,
      activeMinutes: 40,
      source: "manual",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.deduped).toBe(false);
    expect(res.body.data.activity.steps).toBe(5000);
    expect(res.body.data.activity.source).toBe("manual");
  });

  it("manual wins: a device sync does NOT overwrite a manual row for the same day", async () => {
    await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-04",
      steps: 6000,
      distanceMeters: 4000,
      activeMinutes: 50,
      source: "manual",
    });
    const device = await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-04",
      steps: 9999,
      distanceMeters: 9999,
      activeMinutes: 999,
      source: "healthkit",
    });
    expect(device.status).toBe(201);
    expect(device.body.data.deduped).toBe(true);
    expect(device.body.data.activity.steps).toBe(6000);
    expect(device.body.data.activity.source).toBe("manual");
  });

  it("manual overwrites an existing device row for the same day", async () => {
    await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-05",
      steps: 8000,
      distanceMeters: 5000,
      activeMinutes: 60,
      source: "googlefit",
    });
    const manual = await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-05",
      steps: 100,
      distanceMeters: 80,
      activeMinutes: 2,
      source: "manual",
    });
    expect(manual.status).toBe(201);
    expect(manual.body.data.deduped).toBe(false);
    expect(manual.body.data.activity.steps).toBe(100);
    expect(manual.body.data.activity.source).toBe("manual");
    const count = await prisma.activityDaily.count({
      where: { userId, date: new Date("2026-06-05T00:00:00.000Z") },
    });
    expect(count).toBe(1);
  });

  it("a device sync starts the 30-day trust window (Redis key set)", async () => {
    await redis.del(`wearable_trust:${userId}:until`);
    await auth(request(app).post("/api/v1/activity/daily")).send({
      date: "2026-06-06",
      steps: 7000,
      distanceMeters: 4500,
      activeMinutes: 45,
      source: "healthkit",
    });
    const until = await redis.get(`wearable_trust:${userId}:until`);
    expect(until).not.toBeNull();
    // ~30 days out.
    const days = (new Date(until).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it("GET /activity filters by date range, newest first", async () => {
    const res = await auth(request(app).get("/api/v1/activity?from=2026-06-03&to=2026-06-06"));
    expect(res.status).toBe(200);
    const dates = res.body.data.data.map((r: any) => r.date.slice(0, 10));
    expect(dates).toContain("2026-06-03");
    expect(dates).not.toContain("2026-06-01");
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] <= dates[i - 1]).toBe(true);
    }
  });

  it("rejects sleep where sleepEnd is not after sleepStart (400)", async () => {
    const res = await auth(request(app).post("/api/v1/sleep")).send({
      date: "2026-06-07",
      sleepStart: "2026-06-07T06:00:00.000Z",
      sleepEnd: "2026-06-07T05:00:00.000Z",
      durationMinutes: 60,
      quality: "fair",
      source: "manual",
    });
    expect(res.status).toBe(400);
  });

  it("stores a manual sleep row and dedups a later device write", async () => {
    const manual = await auth(request(app).post("/api/v1/sleep")).send({
      date: "2026-06-08",
      sleepStart: "2026-06-08T22:00:00.000Z",
      sleepEnd: "2026-06-09T06:30:00.000Z",
      durationMinutes: 510,
      quality: "good",
      source: "manual",
    });
    expect(manual.status).toBe(201);
    expect(manual.body.data.sleep.durationMinutes).toBe(510);

    const device = await auth(request(app).post("/api/v1/sleep")).send({
      date: "2026-06-08",
      sleepStart: "2026-06-08T23:00:00.000Z",
      sleepEnd: "2026-06-09T05:00:00.000Z",
      durationMinutes: 360,
      quality: "poor",
      source: "googlefit",
    });
    expect(device.status).toBe(201);
    expect(device.body.data.deduped).toBe(true);
    expect(device.body.data.sleep.durationMinutes).toBe(510);
    expect(device.body.data.sleep.source).toBe("manual");
  });
});
