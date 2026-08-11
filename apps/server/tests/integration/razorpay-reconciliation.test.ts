// Phase 4 §K — RAZORPAY_RECONCILIATION cron.
// Drives the reconciliation service directly against a real Postgres +
// Redis (Testcontainers), stubbing `globalThis.fetch` for the Razorpay
// list API exactly like the create-subscription test stubs the create
// API. Integration tests use `any` for prisma bodies per convention.

import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";
import type { ReconciliationSummary } from "../../src/modules/payments/payments-reconciliation.service.js";

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
let prisma: any;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let runRazorpayReconciliation: (opts?: { nowMs?: number }) => Promise<ReconciliationSummary>;

const SEC = 1000;
const DAY_MS = 86_400_000;
const realFetch = globalThis.fetch;

/** Stub Razorpay `GET /subscriptions` to return `items`. */
const razorpayList = (items: unknown[]) =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ entity: "collection", count: items.length, items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

const subEntity = (over: Record<string, unknown>) => ({
  id: `sub_${randomUUID().slice(0, 8)}`,
  status: "active",
  ...over,
});

let householdSeq = 0;
const makeUser = async (tier: string): Promise<string> => {
  const household = await prisma.household.create({ data: {} });
  householdSeq += 1;
  const user = await prisma.user.create({
    data: {
      phone: `+9198400100${String(householdSeq).padStart(2, "0")}`,
      name: "Payer",
      age: 55,
      householdId: household.id,
      onboardingComplete: true,
      tier,
    },
  });
  return user.id as string;
};

const tierOf = async (userId: string): Promise<string> =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } })).tier;

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
  // Configured so the API pass runs; every call is stubbed per test.
  process.env.RAZORPAY_KEY_ID = "rzp_test_keyid";
  process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('bp_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const svc = await import("../../src/modules/payments/payments-reconciliation.service.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  runRazorpayReconciliation = svc.runRazorpayReconciliation;

  await setFlag("payments_razorpay_enabled", true, "test");
  resetFlagCache();
}, 180_000);

afterEach(() => {
  globalThis.fetch = realFetch;
});

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

describe("RAZORPAY_RECONCILIATION — missed activation", () => {
  it("upgrades a free user to premium when Razorpay reports active (missed webhook)", async () => {
    const userId = await makeUser("free");
    const providerSubId = `sub_${randomUUID().slice(0, 8)}`;
    globalThis.fetch = razorpayList([
      subEntity({
        id: providerSubId,
        status: "active",
        current_end: Math.floor((Date.now() + 30 * DAY_MS) / SEC),
        notes: { user_id: userId, tier: "premium" },
      }),
    ]);

    const summary = await runRazorpayReconciliation();

    expect(summary.ranApiPass).toBe(true);
    expect(summary.corrected).toBe(1);
    expect(await tierOf(userId)).toBe("premium");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.tier).toBe("premium");
    expect(sub.status).toBe("active");
    expect(sub.providerSubscriptionId).toBe(providerSubId);
  });

  it("is idempotent — a second run over consistent state corrects nothing", async () => {
    const userId = await makeUser("free");
    const entity = subEntity({
      status: "active",
      current_end: Math.floor((Date.now() + 30 * DAY_MS) / SEC),
      notes: { user_id: userId, tier: "premium" },
    });
    globalThis.fetch = razorpayList([entity]);
    await runRazorpayReconciliation();
    const eventsAfterFirst = await prisma.paymentEvent.count({ where: { userId } });

    // Second run — same provider state, nothing to fix.
    globalThis.fetch = razorpayList([entity]);
    const second = await runRazorpayReconciliation();
    expect(second.corrected).toBe(0);
    expect(await prisma.paymentEvent.count({ where: { userId } })).toBe(eventsAfterFirst);
    expect(await tierOf(userId)).toBe("premium");
  });
});

describe("RAZORPAY_RECONCILIATION — missed renewal", () => {
  it("extends the period when Razorpay's current_end is later (missed charge)", async () => {
    const userId = await makeUser("premium");
    const oldEnd = new Date(Date.now() + 2 * DAY_MS);
    const providerSubId = `sub_${randomUUID().slice(0, 8)}`;
    await prisma.subscription.create({
      data: {
        userId,
        tier: "premium",
        provider: "razorpay",
        providerSubscriptionId: providerSubId,
        status: "active",
        currentPeriodEnd: oldEnd,
      },
    });
    const newEndSec = Math.floor((Date.now() + 32 * DAY_MS) / SEC);
    globalThis.fetch = razorpayList([
      subEntity({
        id: providerSubId,
        status: "active",
        current_end: newEndSec,
        notes: { user_id: userId, tier: "premium" },
      }),
    ]);

    const summary = await runRazorpayReconciliation();
    expect(summary.corrected).toBe(1);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(new Date(sub.currentPeriodEnd).getTime()).toBe(newEndSec * SEC);
    expect(await tierOf(userId)).toBe("premium"); // tier unchanged on extend
  });
});

describe("RAZORPAY_RECONCILIATION — lapsed cancellation (local sweep)", () => {
  it("downgrades a cancelled subscription past its period end and RETAINS all health data", async () => {
    const userId = await makeUser("premium");
    await prisma.subscription.create({
      data: {
        userId,
        tier: "premium",
        provider: "razorpay",
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() - DAY_MS), // lapsed yesterday
      },
    });
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
        source: "manual",
        measuredAt: new Date(),
      },
    });
    const glucoseBefore = await prisma.glucoseReading.count({ where: { userId } });
    const bpBefore = await prisma.bPReading.count({ where: { userId } });

    // Razorpay API returns nothing in the last 24h — the downgrade is
    // driven purely by the local lapsed sweep (Phase B).
    globalThis.fetch = razorpayList([]);
    const summary = await runRazorpayReconciliation();

    expect(summary.lapsedDowngraded).toBe(1);
    expect(await tierOf(userId)).toBe("free");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.tier).toBe("free");
    // Headline invariant: health rows unchanged across the downgrade.
    expect(await prisma.glucoseReading.count({ where: { userId } })).toBe(glucoseBefore);
    expect(await prisma.bPReading.count({ where: { userId } })).toBe(bpBefore);
  });

  it("leaves a cancelled subscription still inside its period untouched", async () => {
    const userId = await makeUser("premium");
    await prisma.subscription.create({
      data: {
        userId,
        tier: "premium",
        provider: "razorpay",
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 5 * DAY_MS), // still active
      },
    });
    globalThis.fetch = razorpayList([]);
    const summary = await runRazorpayReconciliation();
    expect(summary.lapsedDowngraded).toBe(0);
    expect(await tierOf(userId)).toBe("premium");
  });
});

describe("RAZORPAY_RECONCILIATION — resilience + gating", () => {
  it("still runs the local lapsed sweep when the Razorpay API list fails", async () => {
    const userId = await makeUser("premium");
    await prisma.subscription.create({
      data: {
        userId,
        tier: "premium",
        provider: "razorpay",
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      },
    });
    // API list 500s — must not corrupt state, must fall through to sweep.
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("upstream boom", { status: 500 })));

    const summary = await runRazorpayReconciliation();
    expect(summary.ranApiPass).toBe(false);
    expect(summary.errors).toBeGreaterThanOrEqual(1);
    expect(summary.lapsedDowngraded).toBe(1);
    expect(await tierOf(userId)).toBe("free");
  });

  it("skips entirely when payments_razorpay_enabled is off", async () => {
    const userId = await makeUser("premium");
    await prisma.subscription.create({
      data: {
        userId,
        tier: "premium",
        provider: "razorpay",
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      },
    });
    await setFlag("payments_razorpay_enabled", false, "test");
    resetFlagCache();
    const fetchSpy = razorpayList([]);
    globalThis.fetch = fetchSpy;

    const summary = await runRazorpayReconciliation();
    expect(summary.ranApiPass).toBe(false);
    expect(summary.lapsedDowngraded).toBe(0);
    expect(fetchSpy.mock.calls.length).toBe(0); // no API call when disabled
    expect(await tierOf(userId)).toBe("premium"); // NOT downgraded

    await setFlag("payments_razorpay_enabled", true, "test");
    resetFlagCache();
  });

  it("stores an unattributed entity as unresolved without touching any user", async () => {
    globalThis.fetch = razorpayList([
      subEntity({ status: "active", current_end: Math.floor(Date.now() / SEC), notes: {} }),
    ]);
    const summary = await runRazorpayReconciliation();
    expect(summary.unresolved).toBeGreaterThanOrEqual(1);
  });
});
