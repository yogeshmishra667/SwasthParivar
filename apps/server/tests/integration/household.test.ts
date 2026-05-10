import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
let primaryUserId: string;
let primaryHouseholdId: string;
let primaryToken: string;
const PRIMARY_PHONE = "+919823456712";

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
  primaryHouseholdId = household.id;
  const user = await prisma.user.create({
    data: {
      phone: PRIMARY_PHONE,
      name: "Primary",
      age: 60,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  primaryUserId = user.id;
  primaryToken = jwt.sign(
    { sub: user.id, householdId: user.householdId },
    process.env.JWT_SECRET!,
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

describe("POST /api/v1/household/profiles", () => {
  it("creates a profile in the caller's household and returns 201", async () => {
    const res = await request(app)
      .post("/api/v1/household/profiles")
      .set("Authorization", `Bearer ${primaryToken}`)
      .send({
        name: "Sushila",
        age: 58,
        conditions: ["diabetes"],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Sushila");
    expect(res.body.data.age).toBe(58);
    expect(res.body.data.conditions).toEqual(["diabetes"]);

    // Confirm the row landed in the same household.
    const newProfile = await prisma.user.findUnique({
      where: { id: res.body.data.id },
      select: { householdId: true, phone: true },
    });
    expect(newProfile.householdId).toBe(primaryHouseholdId);
    // Synthetic phone uses the `household:` prefix so analytics can filter.
    expect(newProfile.phone.startsWith("household:")).toBe(true);
  });

  it("rejects when over the 8-profile cap with HOUSEHOLD_PROFILE_LIMIT", async () => {
    // Create a fresh household so the previous test doesn't pollute the count.
    const cap = await prisma.household.create({ data: {} });
    const owner = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Cap Owner",
        age: 60,
        householdId: cap.id,
        onboardingComplete: true,
      },
    });
    const token = jwt.sign(
      { sub: owner.id, householdId: owner.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    // Pre-populate up to the cap (cap is 8; owner already counts as 1).
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post("/api/v1/household/profiles")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `Member ${i}`, age: 30, conditions: ["diabetes"] });
      expect(res.status).toBe(201);
    }

    const ninth = await request(app)
      .post("/api/v1/household/profiles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Overflow", age: 30, conditions: ["diabetes"] });
    expect(ninth.status).toBe(409);
    expect(ninth.body.error.code).toBe("HOUSEHOLD_PROFILE_LIMIT");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/v1/household/profiles")
      .send({ name: "Anon", age: 40, conditions: ["diabetes"] });
    expect(res.status).toBe(401);
  });

  it("rejects malformed body via Zod (400)", async () => {
    const res = await request(app)
      .post("/api/v1/household/profiles")
      .set("Authorization", `Bearer ${primaryToken}`)
      .send({ name: "", age: -1, conditions: [] });
    expect(res.status).toBe(400);
  });

  // Reference primaryUserId so the lint rule for unused-vars doesn't fire
  // on the setup variables when this test alone is filtered.
  it("primary user id is set in setup", () => {
    expect(typeof primaryUserId).toBe("string");
  });
});
