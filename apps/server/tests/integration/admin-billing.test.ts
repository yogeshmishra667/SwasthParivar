// Phase 4 §K.6 — admin billing console (subscription table, MRR/churn
// tiles, audited refund trigger). Uses `any` for app/prisma bodies per
// the existing integration-test convention.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import jwt from "jsonwebtoken";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed (${result.status})`);
};

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let supportToken: string;
let opsToken: string;
let superToken: string;
let razorpayUserId: string;

const mkAdmin = async (role: string, email: string): Promise<string> => {
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: "dummy",
      name: `${role} admin`,
      role,
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  return jwt.sign({ sub: admin.id, type: "admin_access" }, process.env.ADMIN_JWT_SECRET!, {
    expiresIn: "1h",
  });
};

const mkUserWithSub = async (
  phone: string,
  sub: {
    tier: string;
    provider: string;
    status: string;
    providerSubscriptionId?: string;
    cancelledAt?: Date;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<string> => {
  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone,
      name: `U${phone.slice(-3)}`,
      age: 55,
      householdId: household.id,
      tier: sub.tier,
    },
  });
  await prisma.subscription.create({
    data: {
      userId: user.id,
      tier: sub.tier,
      provider: sub.provider,
      status: sub.status,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      ...(sub.providerSubscriptionId ? { providerSubscriptionId: sub.providerSubscriptionId } : {}),
      ...(sub.cancelledAt ? { cancelledAt: sub.cancelledAt } : {}),
      ...(sub.cancelAtPeriodEnd ? { cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : {}),
    },
  });
  return user.id;
};

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

  supportToken = await mkAdmin("support", "support@example.com");
  opsToken = await mkAdmin("ops", "ops@example.com");
  superToken = await mkAdmin("super_admin", "super@example.com");

  // Deterministic subscription mix for the metrics assertions:
  //   active premium razorpay + active family apple_iap + a premium
  //   razorpay cancelled THIS month.
  razorpayUserId = await mkUserWithSub("+919800000101", {
    tier: "premium",
    provider: "razorpay",
    status: "active",
    providerSubscriptionId: "sub_RAZORPAY_A",
  });
  await mkUserWithSub("+919800000102", {
    tier: "family",
    provider: "apple_iap",
    status: "active",
    providerSubscriptionId: "orig_APPLE_B",
  });
  await mkUserWithSub("+919800000103", {
    tier: "premium",
    provider: "razorpay",
    status: "cancelled",
    providerSubscriptionId: "sub_RAZORPAY_C",
    cancelAtPeriodEnd: true,
    cancelledAt: new Date(),
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
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

describe("GET /admin/billing/subscriptions", () => {
  it("lists subscriptions with patient info (any admin role)", async () => {
    const res = await request(app)
      .get("/admin/billing/subscriptions")
      .set("Authorization", `Bearer ${supportToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.records).toHaveLength(3);
    expect(res.body.data.records[0]).toHaveProperty("patientPhone");
  });

  it("filters by status and provider", async () => {
    const active = await request(app)
      .get("/admin/billing/subscriptions?status=active")
      .set("Authorization", `Bearer ${supportToken}`);
    expect(active.body.data.total).toBe(2);

    const apple = await request(app)
      .get("/admin/billing/subscriptions?provider=apple_iap")
      .set("Authorization", `Bearer ${supportToken}`);
    expect(apple.body.data.total).toBe(1);
    expect(apple.body.data.records[0].tier).toBe("family");
  });

  it("requires an admin session", async () => {
    const res = await request(app).get("/admin/billing/subscriptions");
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/billing/metrics", () => {
  it("computes MRR, status/provider counts, and churn", async () => {
    const res = await request(app)
      .get("/admin/billing/metrics")
      .set("Authorization", `Bearer ${supportToken}`);
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.mrrInr).toBe(199 + 399); // premium + family active
    expect(m.activeSubscriptions).toBe(2);
    expect(m.byStatus.active).toBe(2);
    expect(m.byStatus.cancelled).toBe(1);
    expect(m.byProvider.razorpay).toBe(2);
    expect(m.byProvider.apple_iap).toBe(1);
    expect(m.churnedThisMonth).toBe(1);
    expect(m.churnRatePct).toBeCloseTo(33.3, 1);
  });
});

describe("POST /admin/billing/subscriptions/:userId/refund", () => {
  it("super_admin resolves the provider deep-link and writes an audit row", async () => {
    const res = await request(app)
      .post(`/admin/billing/subscriptions/${razorpayUserId}/refund`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ reason: "customer requested within 48h" });
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("razorpay");
    expect(res.body.data.refundUrl).toContain(
      "dashboard.razorpay.com/app/subscriptions/sub_RAZORPAY_A",
    );

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "billing.refund_triggered", targetId: razorpayUserId },
    });
    expect(audit).not.toBeNull();
    expect(audit.metadata.reason).toBe("customer requested within 48h");
  });

  it("forbids non-super_admin roles", async () => {
    const res = await request(app)
      .post(`/admin/billing/subscriptions/${razorpayUserId}/refund`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ reason: "should be blocked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("404s when the user has no subscription", async () => {
    const res = await request(app)
      .post(`/admin/billing/subscriptions/${randomUUID()}/refund`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ reason: "no sub" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  it("rejects a missing reason (400)", async () => {
    const res = await request(app)
      .post(`/admin/billing/subscriptions/${razorpayUserId}/refund`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
