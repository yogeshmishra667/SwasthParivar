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
let superAdminToken: string;
let superAdminId: string;

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

  const superAdmin = await prisma.adminUser.create({
    data: {
      email: "audit.viewer@example.com",
      passwordHash: "dummy",
      name: "Audit Viewer",
      role: "super_admin",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  superAdminId = superAdmin.id;
  superAdminToken = jwt.sign(
    { sub: superAdmin.id, type: "admin_access" },
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

describe("Admin Audit Service", () => {
  it("returns paginated audit logs", async () => {
    // Generate some audit logs manually
    await prisma.adminAuditLog.createMany({
      data: [
        {
          adminUserId: superAdminId,
          action: "test.action_1",
          targetType: "system",
          targetId: "system",
          ip: "127.0.0.1",
        },
        {
          adminUserId: superAdminId,
          action: "test.action_2",
          targetType: "user",
          targetId: "some-user-id",
          ip: "127.0.0.1",
        },
      ],
    });

    const res = await request(app)
      .get("/admin/audit?limit=10")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records).toBeInstanceOf(Array);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);

    const firstLog = res.body.data.records[0];
    expect(firstLog.adminEmail).toBe("audit.viewer@example.com");
    expect(firstLog.action).toBeDefined();
  });

  it("filters audit logs by action", async () => {
    const res = await request(app)
      .get("/admin/audit?action=test.action_2")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records.length).toBe(1);
    expect(res.body.data.records[0].action).toBe("test.action_2");
  });
});
