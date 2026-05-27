import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { generateSecret, generateSync } from "otplib";

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
  process.env.ADMIN_TOTP_ISSUER = "Swasth Parivar Test";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
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

describe("Admin Auth Service", () => {
  it("rejects login with invalid credentials", async () => {
    const res = await request(app).post("/admin/auth/login").send({
      email: "does-not-exist@example.com",
      password: "wrong",
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ADMIN_INVALID_CREDENTIALS");
  });

  it("handles the full login -> TOTP enroll -> confirm flow for new admin", async () => {
    const password = "StrongPassword123!";
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.adminUser.create({
      data: {
        email: "new-admin@example.com",
        passwordHash,
        name: "New Admin",
        role: "ops",
        active: true,
        totpEnabled: false,
      },
    });

    // 1. Login should return UNVERIFIED and a challenge token
    const loginRes = await request(app).post("/admin/auth/login").send({
      email: admin.email,
      password,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.stage).toBe("totp_enrollment_required");
    const challengeToken = loginRes.body.data.challengeToken;
    expect(challengeToken).toBeDefined();

    // 2. Enroll TOTP
    const enrollRes = await request(app).post("/admin/auth/totp/enroll").send({
      challengeToken,
    });
    expect(enrollRes.status).toBe(200);
    expect(enrollRes.body.data.secret).toBeDefined();
    expect(enrollRes.body.data.otpauthUrl).toBeDefined();

    const totpSecret = enrollRes.body.data.secret;
    const validCode = generateSync({ secret: totpSecret });

    // 3. Confirm TOTP
    const confirmRes = await request(app).post("/admin/auth/totp/confirm").send({
      challengeToken,
      code: validCode,
    });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.stage).toBe("authenticated");
    expect(confirmRes.body.data.accessToken).toBeDefined();

    // Refresh token should be set in cookies
    const cookies = confirmRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies![0]).toContain("refresh_token=");
    expect(cookies![0]).toContain("admin_refresh=");

    // Verify user is now enrolled in DB
    const updatedAdmin = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    expect(updatedAdmin!.totpEnabled).toBe(true);
  });

  it("handles login -> TOTP verify flow for enrolled admin", async () => {
    const password = "StrongPassword123!";
    const passwordHash = await bcrypt.hash(password, 10);
    const totpSecret = generateSecret();

    const admin = await prisma.adminUser.create({
      data: {
        email: "enrolled-admin@example.com",
        passwordHash,
        name: "Enrolled Admin",
        role: "super_admin",
        active: true,
        totpEnabled: true,
        totpSecret,
      },
    });

    const loginRes = await request(app).post("/admin/auth/login").send({
      email: admin.email,
      password,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.stage).toBe("totp_required");
    const challengeToken = loginRes.body.data.challengeToken;

    const validCode = generateSync({ secret: totpSecret });
    const verifyRes = await request(app).post("/admin/auth/totp/verify").send({
      challengeToken,
      code: validCode,
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.stage).toBe("authenticated");
    expect(verifyRes.body.data.accessToken).toBeDefined();

    // Test /me endpoint
    const meRes = await request(app)
      .get("/admin/auth/me")
      .set("Authorization", `Bearer ${verifyRes.body.data.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(admin.email);
    expect(meRes.body.data.role).toBe(admin.role);
  });

  it("fails TOTP verification with incorrect code", async () => {
    const password = "StrongPassword123!";
    const passwordHash = await bcrypt.hash(password, 10);
    const totpSecret = generateSecret();

    const admin = await prisma.adminUser.create({
      data: {
        email: "fail-totp@example.com",
        passwordHash,
        name: "Fail TOTP",
        role: "ops",
        active: true,
        totpEnabled: true,
        totpSecret,
      },
    });

    const loginRes = await request(app).post("/admin/auth/login").send({
      email: admin.email,
      password,
    });
    const challengeToken = loginRes.body.data.challengeToken;

    const verifyRes = await request(app).post("/admin/auth/totp/verify").send({
      challengeToken,
      code: "000000", // Invalid code
    });

    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.error.code).toBe("ADMIN_2FA_INVALID");
  });
});
