// Integration tests use `any` for `app` / `prisma` / `supertest` bodies
// to match the existing convention in readings.test.ts. The eslint
// no-unsafe-* family triggers on every field access; tracked for cleanup
// across all integration tests in the fix/lint-cleanup branch.

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
const TEST_PHONE = "+919812345671";

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
      "SELECT create_hypertable('meal_logs', 'logged_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Meal Tester",
      age: 60,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
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

describe("POST /api/v1/meals", () => {
  it("saves a meal log and echoes the persisted row", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        mealType: "lunch",
        mealCategory: "normal",
        foodDescription: "dal chawal sabzi",
        loggedAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.meal.mealType).toBe("lunch");
    expect(res.body.data.meal.mealCategory).toBe("normal");
    expect(res.body.data.meal.foodDescription).toBe("dal chawal sabzi");
    expect(res.body.data.meal.clientUuid).toBe(clientUuid);
  });

  it("rejects unknown mealCategory with 400", async () => {
    const res = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        mealType: "dinner",
        mealCategory: "spicy",
        loggedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects stale version with MEAL_STALE_VERSION", async () => {
    const clientUuid = randomUUID();
    const loggedAt = new Date().toISOString();
    const first = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        mealType: "breakfast",
        mealCategory: "light",
        loggedAt,
        version: 2,
      });
    expect(first.status).toBe(201);

    const stale = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        mealType: "breakfast",
        mealCategory: "light",
        loggedAt,
        version: 1,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("MEAL_STALE_VERSION");
  });

  it("idempotent upsert: same clientUuid with higher version updates in place", async () => {
    const clientUuid = randomUUID();
    const loggedAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        mealType: "snack",
        mealCategory: "light",
        loggedAt,
        version: 1,
      })
      .expect(201);

    const edited = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        mealType: "snack",
        mealCategory: "heavy_fried",
        foodDescription: "samosa",
        loggedAt,
        version: 2,
      });
    expect(edited.status).toBe(201);
    expect(edited.body.data.meal.mealCategory).toBe("heavy_fried");
    expect(edited.body.data.meal.foodDescription).toBe("samosa");

    const count = await prisma.mealLog.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });
});

describe("GET /api/v1/meals", () => {
  it("filters by mealCategory", async () => {
    const res = await request(app)
      .get("/api/v1/meals?mealCategory=heavy_fried&limit=50")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data.data) {
      expect(row.mealCategory).toBe("heavy_fried");
    }
  });

  it("returns meals in descending loggedAt order", async () => {
    const res = await request(app)
      .get("/api/v1/meals?limit=10")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    for (let i = 1; i < res.body.data.data.length; i++) {
      const prev = new Date(res.body.data.data[i - 1].loggedAt).getTime();
      const curr = new Date(res.body.data.data[i].loggedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("DELETE /api/v1/meals/:id", () => {
  it("removes a meal log owned by the caller", async () => {
    const created = await request(app)
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        mealType: "dinner",
        mealCategory: "light",
        loggedAt: new Date().toISOString(),
      });
    const id = created.body.data.meal.id;

    const del = await request(app)
      .delete(`/api/v1/meals/${id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const remaining = await prisma.mealLog.findFirst({ where: { id } });
    expect(remaining).toBeNull();
  });
});
