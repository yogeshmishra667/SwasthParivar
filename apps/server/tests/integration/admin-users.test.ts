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
let supportToken: string;
let operatorToken: string;

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
      email: "support@example.com",
      passwordHash: "dummy",
      name: "Support Admin",
      role: "support",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  supportToken = jwt.sign(
    { sub: supportAdmin.id, type: "admin_access" },
    process.env.ADMIN_JWT_SECRET,
    {
      expiresIn: "1h",
    },
  );

  const operatorAdmin = await prisma.adminUser.create({
    data: {
      email: "operator@example.com",
      passwordHash: "dummy",
      name: "Operator Admin",
      role: "ops", // the role is "ops" not "operator"
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  operatorToken = jwt.sign(
    { sub: operatorAdmin.id, type: "admin_access" },
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

describe("Admin Users Service", () => {
  it("lists users with pagination", async () => {
    // Create test household + user
    const household = await prisma.household.create({ data: {} });
    await prisma.user.create({
      data: {
        phone: "+919800000001",
        name: "Pagination Test",
        age: 30,
        householdId: household.id,
        onboardingComplete: true,
      },
    });

    const res = await request(app)
      .get("/admin/users?limit=10&offset=0")
      .set("Authorization", `Bearer ${supportToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it("gets user detail profile", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: "+919800000002",
        name: "Detail Test",
        age: 40,
        householdId: household.id,
        onboardingComplete: true,
      },
    });

    const res = await request(app)
      .get(`/admin/users/${user.id}`)
      .set("Authorization", `Bearer ${supportToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Detail Test");
    expect(res.body.data.streak).toBeDefined();
    expect(res.body.data.panels).toBeInstanceOf(Array);
  });

  it("updates user tier and logs audit correctly (ops only)", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: "+919800000003",
        name: "Tier Test",
        age: 25,
        householdId: household.id,
        onboardingComplete: true,
        tier: "free",
      },
    });

    // Try with support role - should fail
    const supportRes = await request(app)
      .patch(`/admin/users/${user.id}/tier`)
      .set("Authorization", `Bearer ${supportToken}`)
      .set("X-Admin-Actor", "support@example.com")
      .send({ tier: "premium", reason: "testing" });

    expect(supportRes.status).toBe(403);
    expect(supportRes.body.error.code).toBe("ADMIN_FORBIDDEN");

    // Try with ops role - should succeed
    const opsRes = await request(app)
      .patch(`/admin/users/${user.id}/tier`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ tier: "premium", reason: "upgrade test" });

    expect(opsRes.status).toBe(200);
    expect(opsRes.body.data.tier).toBe("premium");

    const audit = await request(app)
      .get("/admin/audit?action=user.tier_changed")
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(audit.status).toBe(200);
    const log = audit.body.data.records.find((r: any) => r.targetId === user.id);
    expect(log).toBeDefined();
    expect(log.adminEmail).toBe("operator@example.com");
    expect(log.metadata.to).toBe("premium");
  });
});
