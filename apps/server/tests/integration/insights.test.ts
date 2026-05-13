// See readings.test.ts for the lint-disable rationale.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
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
let userId: string;
let accessToken: string;
const TEST_PHONE = "+919812345672";

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

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Insight Tester",
      age: 62,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  userId = user.id;
  accessToken = jwt.sign(
    { sub: user.id, householdId: user.householdId },
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

const seedInsight = (overrides: Record<string, unknown> = {}): Promise<any> => {
  return prisma.insightEvent.create({
    data: {
      userId,
      patternType: "spike",
      conditionsInvolved: ["glucose"],
      severityScore: 70,
      severityLevel: "warn",
      messageKey: "insight.spike.warn",
      messageParams: { value: 240, baseline: 130 },
      triggerReadings: ["r1", "r2"],
      evidence: { stdDev: 25 },
      confidence: 0.85,
      ...overrides,
    },
  });
};

describe("GET /api/v1/insights", () => {
  it("returns the caller's insights in descending createdAt order", async () => {
    await seedInsight();
    await seedInsight({ severityLevel: "info", severityScore: 30 });

    const res = await request(app)
      .get("/api/v1/insights?limit=10")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.data)).toBe(true);
    expect(res.body.data.data.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < res.body.data.data.length; i++) {
      const prev = new Date(res.body.data.data[i - 1].createdAt).getTime();
      const curr = new Date(res.body.data.data[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("filters by severity", async () => {
    await seedInsight({ severityLevel: "critical", severityScore: 90 });

    const res = await request(app)
      .get("/api/v1/insights?severity=critical")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data.data) {
      expect(row.severityLevel).toBe("critical");
    }
  });

  it("filters by acknowledged=false", async () => {
    const ack = await seedInsight({ acknowledged: true });

    const res = await request(app)
      .get("/api/v1/insights?acknowledged=false&limit=100")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data.data) {
      expect(row.acknowledged).toBe(false);
      expect(row.id).not.toBe(ack.id);
    }
  });

  it("hides low-confidence insights from the feed", async () => {
    // Insights below the 0.7 confidence floor are persisted (analytics)
    // but suppressed from the API response — never shown to patients.
    const lowConf = await seedInsight({ confidence: 0.5 });

    const res = await request(app)
      .get("/api/v1/insights?limit=100")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.data.find((r: any) => r.id === lowConf.id)).toBeUndefined();
  });
});

describe("POST /api/v1/insights/:id/acknowledge", () => {
  it("flips acknowledged=true and records helpful when provided", async () => {
    const seeded = await seedInsight();

    const res = await request(app)
      .post(`/api/v1/insights/${seeded.id}/acknowledge`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ helpful: true });
    expect(res.status).toBe(200);
    expect(res.body.data.insight.acknowledged).toBe(true);
    expect(res.body.data.insight.helpful).toBe(true);
  });

  it("rejects acknowledge from a different user with INSIGHT_NOT_FOUND", async () => {
    const seeded = await seedInsight();

    const otherHousehold = await prisma.household.create({ data: {} });
    const otherUser = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Outsider",
        age: 45,
        householdId: otherHousehold.id,
        onboardingComplete: true,
      },
    });
    const otherToken: string = jwt.sign(
      { sub: otherUser.id, householdId: otherUser.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    const res = await request(app)
      .post(`/api/v1/insights/${seeded.id as string}/acknowledge`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ helpful: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INSIGHT_NOT_FOUND");
  });

  it("404s on unknown insight id", async () => {
    const res = await request(app)
      .post(`/api/v1/insights/${randomUUID()}/acknowledge`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
