// Phase 4 §K.5 — Razorpay webhook safety + tier transitions.
// Integration tests use `any` for app/prisma bodies per the existing
// convention (readings/meals tests).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed (${result.status})`);
};

const WEBHOOK_SECRET = "whsec_test_razorpay_secret";
let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let userId: string;
let accessToken: string;

const sign = (raw: string): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

const postWebhook = (bodyObj: unknown, opts: { sig?: string; eventId?: string } = {}) => {
  const raw = JSON.stringify(bodyObj);
  const req = request(app)
    .post("/api/v1/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", opts.sig ?? sign(raw))
    .set("x-razorpay-event-id", opts.eventId ?? randomUUID());
  return req.send(raw);
};

const subEvent = (event: string, currentEnd?: number) => ({
  event,
  payload: {
    subscription: {
      entity: {
        id: "sub_RAZORPAY123",
        ...(currentEnd ? { current_end: currentEnd } : {}),
        notes: { user_id: userId, tier: "premium" },
      },
    },
  },
});

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
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: "+919840000001",
      name: "Payer",
      age: 55,
      householdId: household.id,
      onboardingComplete: true,
      tier: "free",
    },
  });
  userId = user.id;
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  await setFlag("payments_razorpay_enabled", true, "test");
  resetFlagCache();
}, 180_000);

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

const tierOf = async (): Promise<string> =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } })).tier;

describe("POST /api/v1/webhooks/razorpay — signature", () => {
  it("rejects an invalid signature with 401 and changes no state", async () => {
    const before = await tierOf();
    const res = await postWebhook(subEvent("subscription.activated"), { sig: "deadbeef" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    expect(await tierOf()).toBe(before);
    expect(await prisma.paymentEvent.count()).toBe(0); // no row on bad signature
  });

  it("503s when payments_razorpay_enabled is off", async () => {
    await setFlag("payments_razorpay_enabled", false, "test");
    resetFlagCache();
    const res = await postWebhook(subEvent("subscription.activated"));
    expect(res.status).toBe(503);
    await setFlag("payments_razorpay_enabled", true, "test");
    resetFlagCache();
  });
});

describe("POST /api/v1/webhooks/razorpay — tier transitions", () => {
  it("subscription.activated upgrades the user to premium (transactional)", async () => {
    const res = await postWebhook(subEvent("subscription.activated"));
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("activate");
    expect(await tierOf()).toBe("premium");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.tier).toBe("premium");
    expect(sub.status).toBe("active");
  });

  it("is idempotent — replaying the same event id is a no-op", async () => {
    const eventId = randomUUID();
    const first = await postWebhook(subEvent("subscription.charged"), { eventId });
    expect(first.status).toBe(200);
    const countAfterFirst = await prisma.paymentEvent.count();
    const replay = await postWebhook(subEvent("subscription.charged"), { eventId });
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);
    expect(await prisma.paymentEvent.count()).toBe(countAfterFirst);
  });

  it("DOWNGRADE on refund retains ALL patient health data (zero deletes)", async () => {
    // Seed health rows while premium.
    await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId,
        valueMgDl: 120,
        readingType: "fasting",
        source: "manual",
        measuredAt: new Date(),
        streakCreditedTo: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    await prisma.bPReading.create({
      data: {
        clientUuid: randomUUID(),
        userId,
        systolic: 130,
        diastolic: 85,
        measuredAt: new Date(),
        streakCreditedTo: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    const glucoseBefore = await prisma.glucoseReading.count({ where: { userId } });
    const bpBefore = await prisma.bPReading.count({ where: { userId } });
    expect(glucoseBefore).toBeGreaterThan(0);

    const res = await postWebhook(subEvent("refund.processed"));
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("downgrade");
    expect(await tierOf()).toBe("free");

    // The headline invariant: row counts unchanged across the downgrade.
    expect(await prisma.glucoseReading.count({ where: { userId } })).toBe(glucoseBefore);
    expect(await prisma.bPReading.count({ where: { userId } })).toBe(bpBefore);
  });

  it("payment.failed marks past_due without downgrading", async () => {
    // Re-upgrade first.
    await postWebhook(subEvent("subscription.activated"));
    expect(await tierOf()).toBe("premium");
    const res = await postWebhook(subEvent("payment.failed"));
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("past_due");
    expect(await tierOf()).toBe("premium"); // NOT downgraded
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.status).toBe("past_due");
  });

  it("subscription.cancelled keeps the tier and flags cancelAtPeriodEnd", async () => {
    const res = await postWebhook(subEvent("subscription.cancelled"));
    expect(res.status).toBe(200);
    expect(await tierOf()).toBe("premium"); // retained until period end
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.status).toBe("cancelled");
  });
});

describe("GET /api/v1/payments/subscription", () => {
  it("returns the caller's subscription", async () => {
    const res = await request(app)
      .get("/api/v1/payments/subscription")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.userId).toBe(userId);
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/payments/subscription");
    expect(res.status).toBe(401);
  });
});
