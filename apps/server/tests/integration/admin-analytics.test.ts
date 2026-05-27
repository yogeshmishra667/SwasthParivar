import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import jwt from "jsonwebtoken";
import { spawnSync } from "node:child_process";

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
let supportAdminToken: string;

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
  process.env.ADMIN_JWT_SECRET = "test-admin-secret-test-admin-secret-123";
  process.env.ADMIN_JWT_REFRESH_SECRET = "test-admin-refresh-secret-test-123";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const supportAdmin = await prisma.adminUser.create({
    data: {
      email: "analytics.viewer@example.com",
      passwordHash: "dummy",
      name: "Analytics Viewer",
      role: "support",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  supportAdminToken = jwt.sign(
    { sub: supportAdmin.id, type: "admin_access" },
    process.env.ADMIN_JWT_SECRET,
    {
      expiresIn: "1h",
    },
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
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

describe("Admin Analytics Service", () => {
  it("returns key KPIs for the dashboard", async () => {
    // Generate some test data
    const household = await prisma.household.create({ data: {} });
    await prisma.user.create({
      data: {
        phone: "+919800000004",
        name: "Analytics User 1",
        age: 30,
        householdId: household.id,
        onboardingComplete: true,
        tier: "premium",
      },
    });

    const res = await request(app)
      .get("/admin/analytics/overview")
      .set("Authorization", `Bearer ${supportAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toBeDefined();
    expect(res.body.data.metrics).toBeInstanceOf(Array);
  });

  it("returns timeseries growth data", async () => {
    const res = await request(app)
      .get("/admin/analytics/tier_distribution")
      .set("Authorization", `Bearer ${supportAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe("tier_distribution");
    expect(res.body.data.label).toBeDefined();
  });
});
