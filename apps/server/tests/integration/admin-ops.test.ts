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
let opsAdminToken: string;
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

  const opsAdmin = await prisma.adminUser.create({
    data: {
      email: "ops@example.com",
      passwordHash: "dummy",
      name: "Ops Admin",
      role: "ops",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  opsAdminToken = jwt.sign(
    { sub: opsAdmin.id, type: "admin_access" },
    process.env.ADMIN_JWT_SECRET,
    {
      expiresIn: "1h",
    },
  );

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

describe("Admin Ops Service", () => {
  it("rejects support admin from ops endpoints", async () => {
    const res = await request(app)
      .get("/admin/ops/health")
      .set("Authorization", `Bearer ${supportAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("returns health summary for ops admin", async () => {
    const res = await request(app)
      .get("/admin/ops/health")
      .set("Authorization", `Bearer ${opsAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBeDefined();
    expect(["ok", "degraded"]).toContain(res.body.data.status);
    expect(res.body.data.checks.db).toBeDefined();
    expect(res.body.data.checks.redis).toBeDefined();
  });

  it("returns queue status for ops admin", async () => {
    const res = await request(app)
      .get("/admin/ops/queues")
      .set("Authorization", `Bearer ${opsAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.queues).toBeInstanceOf(Array);
  });
});
