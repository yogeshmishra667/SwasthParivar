// Integration tests for the Bull-board mount + auth wrapper.
//
// Covers:
//   - Missing token → 401
//   - Invalid token → 401
//   - Wrong role (support) → 403
//   - super_admin via ?token=… → 302 redirect + bb_session cookie set
//   - Subsequent navigation via bb_session cookie → 200
//   - ops role accepted
//
// Bull-board injects its own HTML; we only assert the auth handshake
// and the redirect-to-cookie flow. The bull-board UI surface itself
// is tested upstream by the @bull-board package.

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
let app: any;
let prisma: any;

let superAdminId: string;
let opsAdminId: string;
let supportAdminId: string;
let superAdminToken: string;
let opsAdminToken: string;
let supportAdminToken: string;

const ADMIN_SECRET = "test-admin-secret-test-admin-secret-test";

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
  process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;

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
      email: "super@swasth.test",
      name: "Super",
      role: "super_admin",
      passwordHash: "x",
      totpSecret: "x",
      active: true,
    },
  });
  const opsAdmin = await prisma.adminUser.create({
    data: {
      email: "ops@swasth.test",
      name: "Ops",
      role: "ops",
      passwordHash: "x",
      totpSecret: "x",
      active: true,
    },
  });
  const supportAdmin = await prisma.adminUser.create({
    data: {
      email: "support@swasth.test",
      name: "Support",
      role: "support",
      passwordHash: "x",
      totpSecret: "x",
      active: true,
    },
  });

  superAdminId = superAdmin.id;
  opsAdminId = opsAdmin.id;
  supportAdminId = supportAdmin.id;
  superAdminToken = jwt.sign({ sub: superAdminId, type: "admin_access" }, ADMIN_SECRET, {
    expiresIn: "1h",
  });
  opsAdminToken = jwt.sign({ sub: opsAdminId, type: "admin_access" }, ADMIN_SECRET, {
    expiresIn: "1h",
  });
  supportAdminToken = jwt.sign({ sub: supportAdminId, type: "admin_access" }, ADMIN_SECRET, {
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

describe("/admin/queues — Bull-board auth gate", () => {
  it("rejects requests with no token (401)", async () => {
    const res = await request(app).get("/admin/queues");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ADMIN_INVALID_CREDENTIALS");
  });

  it("rejects an invalid token (401)", async () => {
    const res = await request(app).get("/admin/queues?token=not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ADMIN_INVALID_CREDENTIALS");
  });

  it("rejects a wrong-type token (401)", async () => {
    const wrongType = jwt.sign({ sub: superAdminId, type: "refresh" }, ADMIN_SECRET, {
      expiresIn: "1h",
    });
    const res = await request(app).get(`/admin/queues?token=${wrongType}`);
    expect(res.status).toBe(401);
  });

  it("forbids a support admin (403)", async () => {
    const res = await request(app).get(`/admin/queues?token=${supportAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("super_admin via ?token=… → 302 redirect + bb_session cookie set", async () => {
    const res = await request(app).get(`/admin/queues?token=${superAdminToken}`);
    expect(res.status).toBe(302);
    // Trailing slash is added by express's path normalization for mount
    // points — either form lands at the same bull-board UI.
    expect(res.headers.location).toMatch(/^\/admin\/queues\/?$/);
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie);
    expect(cookieHeader).toContain("bb_session=");
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Path=/admin/queues");
  });

  it("subsequent navigation via bb_session cookie passes the gate", async () => {
    const res = await request(app)
      .get("/admin/queues/")
      .set("Cookie", `bb_session=${superAdminToken}`);
    // bull-board's own router handles `/` — we only care that auth passed.
    // 200 (UI HTML) is the success signal; 302 would mean a re-auth loop.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("ops role is accepted (302 redirect on first hit)", async () => {
    const res = await request(app).get(`/admin/queues?token=${opsAdminToken}`);
    expect(res.status).toBe(302);
  });

  it("query-token is stripped from the redirect Location", async () => {
    const res = await request(app).get(`/admin/queues?token=${superAdminToken}&foo=bar`);
    expect(res.status).toBe(302);
    // foo=bar is preserved; token=… is gone.
    expect(res.headers.location).toMatch(/^\/admin\/queues\/?\?foo=bar$/);
    expect(res.headers.location).not.toContain("token=");
  });
});
