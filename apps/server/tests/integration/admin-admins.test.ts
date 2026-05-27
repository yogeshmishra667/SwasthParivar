import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import jwt from "jsonwebtoken";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";

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
let opsAdminToken: string;
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
      email: "super@example.com",
      passwordHash: "dummy",
      name: "Super Admin",
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

describe("Admin Admins Service (Staff Management)", () => {
  it("rejects non-super_admin from accessing routes", async () => {
    const res = await request(app)
      .get("/admin/admins")
      .set("Authorization", `Bearer ${opsAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("lists all admins", async () => {
    const res = await request(app)
      .get("/admin/admins")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.admins).toBeInstanceOf(Array);
    expect(res.body.data.admins.length).toBeGreaterThanOrEqual(2);
  });

  let newAdminId: string;

  it("creates a new admin", async () => {
    const res = await request(app)
      .post("/admin/admins")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("X-Admin-Actor", "super@example.com")
      .send({
        email: "newstaff@example.com",
        password: "TempPassword123!",
        name: "New Staff",
        role: "support",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("newstaff@example.com");
    expect(res.body.data.role).toBe("support");
    expect(res.body.data.active).toBe(true);
    newAdminId = res.body.data.id;

    const dbUser = await prisma.adminUser.findUnique({ where: { id: newAdminId } });
    expect(dbUser).toBeDefined();

    // Check audit log
    const auditRes = await request(app)
      .get("/admin/audit?action=admin.created")
      .set("Authorization", `Bearer ${superAdminToken}`);

    const auditLog = auditRes.body.data.records.find((r: any) => r.targetId === newAdminId);
    expect(auditLog).toBeDefined();
  });

  it("updates an existing admin role and active state", async () => {
    const res = await request(app)
      .patch(`/admin/admins/${newAdminId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("X-Admin-Actor", "super@example.com")
      .send({
        role: "analyst",
        active: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("analyst");
    expect(res.body.data.active).toBe(false);

    const dbUser = await prisma.adminUser.findUnique({ where: { id: newAdminId } });
    expect(dbUser!.role).toBe("analyst");
    expect(dbUser!.active).toBe(false);

    // Check audit log
    const auditRes = await request(app)
      .get("/admin/audit?action=admin.updated")
      .set("Authorization", `Bearer ${superAdminToken}`);

    const auditLog = auditRes.body.data.records.find((r: any) => r.targetId === newAdminId);
    expect(auditLog).toBeDefined();
    expect(auditLog.metadata.role).toBe("analyst");
    expect(auditLog.metadata.active).toBe(false);
  });

  it("prevents super_admin from deactivating themselves", async () => {
    const res = await request(app)
      .patch(`/admin/admins/${superAdminId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("X-Admin-Actor", "super@example.com")
      .send({
        active: false,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("resets admin password", async () => {
    const newPassword = "NewStrongPassword456!";
    const res = await request(app)
      .post(`/admin/admins/${newAdminId}/reset-password`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("X-Admin-Actor", "super@example.com")
      .send({
        password: newPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(newAdminId);

    const dbUser = await prisma.adminUser.findUnique({ where: { id: newAdminId } });
    const isMatch = await bcrypt.compare(newPassword, dbUser!.passwordHash);
    expect(isMatch).toBe(true);
  });
});
