// Integration tests use `any` for `app` / `prisma` / `supertest` bodies
// to match the existing convention in readings.test.ts. The eslint
// no-unsafe-* family triggers on every field access; tracked for cleanup
// across both files in the fix/lint-cleanup branch.
 
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

// BP integration suite — mirrors readings.test.ts container/auth setup.
// Separate file so a failure here doesn't gate the glucose tests and
// vice-versa. Postgres + Redis containers are owned per file because the
// project's vitest config runs each test file in its own worker.

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
const TEST_PHONE = "+919812345670";

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
  // Convert hypertable-ready tables — same pattern as readings.test.ts.
  runPrisma(["db", "execute", "--stdin"], {
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('bp_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "BP Tester",
      age: 55,
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

describe("POST /api/v1/readings/bp", () => {
  it("saves a reading and echoes the persisted row", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 128,
        diastolic: 82,
        pulse: 74,
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reading.systolic).toBe(128);
    expect(res.body.data.reading.diastolic).toBe(82);
    expect(res.body.data.reading.pulse).toBe(74);
    expect(res.body.data.reading.clientUuid).toBe(clientUuid);
  });

  it("rejects systolic <= diastolic with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        systolic: 80,
        diastolic: 80,
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects systolic below medical floor (60) with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        systolic: 50,
        diastolic: 40,
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects stale version with READING_STALE_VERSION", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    const first = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 130,
        diastolic: 85,
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(first.status).toBe(201);

    const stale = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 130,
        diastolic: 85,
        source: "manual",
        measuredAt,
        version: 1,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("READING_STALE_VERSION");
  });

  it("idempotent upsert: same clientUuid with higher version updates in place", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 125,
        diastolic: 80,
        source: "manual",
        measuredAt,
        version: 1,
      })
      .expect(201);

    const edited = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 132,
        diastolic: 86,
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(edited.status).toBe(201);
    expect(edited.body.data.reading.systolic).toBe(132);
    expect(edited.body.data.reading.diastolic).toBe(86);

    const count = await prisma.bPReading.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });
});

describe("GET /api/v1/readings/bp", () => {
  it("returns the caller's BP readings in descending measuredAt order", async () => {
    const res = await request(app)
      .get("/api/v1/readings/bp?limit=10")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.data)).toBe(true);
    for (let i = 1; i < res.body.data.data.length; i++) {
      const prev = new Date(res.body.data.data[i - 1].measuredAt).getTime();
      const curr = new Date(res.body.data.data[i].measuredAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("DELETE /api/v1/readings/bp/:id", () => {
  it("removes a reading owned by the caller", async () => {
    const clientUuid = randomUUID();
    const created = await request(app)
      .post("/api/v1/readings/bp")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        systolic: 122,
        diastolic: 78,
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    const id = created.body.data.reading.id;

    const del = await request(app)
      .delete(`/api/v1/readings/bp/${id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const remaining = await prisma.bPReading.findFirst({ where: { id } });
    expect(remaining).toBeNull();
  });
});
