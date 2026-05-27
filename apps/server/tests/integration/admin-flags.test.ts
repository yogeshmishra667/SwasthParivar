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
let adminToken: string;

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

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const admin = await prisma.adminUser.create({
    data: {
      email: "test-ops@example.com",
      passwordHash: "dummy",
      name: "Ops Test",
      role: "ops",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });

  adminToken = jwt.sign({ sub: admin.id, type: "admin_access" }, process.env.ADMIN_JWT_SECRET, {
    expiresIn: "1h",
  });

  const { __resetFlagCache } = await import("../../src/shared/flags/index.js");
  __resetFlagCache();
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

describe("Admin flag service", () => {
  it("rejects missing admin token with 401", async () => {
    const res = await request(app).get("/admin/flags");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ADMIN_INVALID_CREDENTIALS");
  });

  it("rejects wrong admin token with 401", async () => {
    const res = await request(app)
      .get("/admin/flags")
      .set("Authorization", "Bearer not-the-real-token-not-the-real-token");
    expect(res.status).toBe(401);
  });

  it("PUT then GET returns the set value, audit log captures the change", async () => {
    const put = await request(app)
      .put("/admin/flags/otp_provider")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-Admin-Actor", "operator-yogesh")
      .send({ value: "sms" });
    expect(put.status).toBe(200);
    expect(put.body.data.newValue).toBe("sms");
    expect(put.body.data.prevValue).toBeNull();

    const get = await request(app)
      .get("/admin/flags/otp_provider")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data.value).toBe("sms");

    const audit = await request(app)
      .get("/admin/flags/otp_provider/audit")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.records).toHaveLength(1);
    expect(audit.body.data.records[0].by).toBe("test-ops@example.com");
    expect(audit.body.data.records[0].newValue).toBe("sms");
  });

  it("supports boolean + object values", async () => {
    await request(app)
      .put("/admin/flags/sms_msg91_enabled")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: false });

    await request(app)
      .put("/admin/flags/notification_caps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: { daily: 2, peak_hour: 1 } });

    const list = await request(app)
      .get("/admin/flags")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.flags.sms_msg91_enabled).toBe(false);
    expect(list.body.data.flags.notification_caps).toEqual({ daily: 2, peak_hour: 1 });
  });

  it("rejects invalid flag key with 400", async () => {
    const res = await request(app)
      .put("/admin/flags/INVALID-KEY")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: true });
    expect(res.status).toBe(400);
  });

  it("getFlag returns the default when key is unset", async () => {
    const { getFlag } = await import("../../src/shared/flags/index.js");
    const result = await getFlag<boolean>("never_set_key", true);
    expect(result).toBe(true);
  });
});
