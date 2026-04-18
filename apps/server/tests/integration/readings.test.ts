import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
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
let accessToken: string;
const TEST_PHONE = "+919812345678";

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
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Test Patient",
      age: 55,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign(
    { sub: user.id, householdId: user.householdId },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" },
  );
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
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

describe("POST /api/v1/readings/glucose", () => {
  it("saves a reading and returns streak + feedback", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 110,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reading.valueMgDl).toBe(110);
    expect(res.body.data.streak.currentStreakDays).toBeGreaterThanOrEqual(1);
    expect(res.body.data.feedback).toBeDefined();
    expect(res.body.data.critical.isCritical).toBe(false);
  });

  it("rejects stale version with READING_STALE_VERSION", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 100,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(first.status).toBe(200);

    const stale = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 100,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 1,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("READING_STALE_VERSION");
  });

  it("flags critical=true for glucose < 65", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.critical.isCritical).toBe(true);
    expect(res.body.data.critical.severity).toBe("low");
    expect(res.body.data.critical.showFullscreenAlert).toBe(true);
  });
});

describe("POST /api/v1/sync/push", () => {
  it("reports per-row stale status for outdated version", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();

    const firstPush = await request(app)
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        changes: {
          glucoseReadings: [
            {
              clientUuid,
              valueMgDl: 120,
              readingType: "fasting",
              context: "normal",
              source: "manual",
              measuredAt,
              version: 3,
            },
          ],
        },
      });
    expect(firstPush.status).toBe(200);
    expect(firstPush.body.data.results[0].status).toBe("accepted");

    const stalePush = await request(app)
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        changes: {
          glucoseReadings: [
            {
              clientUuid,
              valueMgDl: 120,
              readingType: "fasting",
              context: "normal",
              source: "manual",
              measuredAt,
              version: 2,
            },
          ],
        },
      });
    expect(stalePush.status).toBe(200);
    expect(stalePush.body.data.results[0].status).toBe("stale");
  });
});
