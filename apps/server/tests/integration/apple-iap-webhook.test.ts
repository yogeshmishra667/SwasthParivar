// Phase 4 §K.5 — Apple IAP: App Store Server Notifications V2 webhook +
// receipt verification. Uses `any` for app/prisma bodies per the
// existing integration-test convention (readings/meals/razorpay tests).

import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { createSign, X509Certificate, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

const BUNDLE_ID = "com.swasth.app";
const PREMIUM_PRODUCT = "com.swasth.premium";
const FAMILY_PRODUCT = "com.swasth.family";

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed (${result.status})`);
};

// ── ES256 cert chain (openssl) + JWS signing ────────────────────────
const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");

const openssl = (dir: string, args: string[]): void => {
  const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`openssl ${args.join(" ")} failed: ${r.stderr}`);
};

let certDir: string;
let rootPem: string;
let leafKeyPem: string;
let x5c: string[];

const makeChain = (): void => {
  certDir = mkdtempSync(join(tmpdir(), "apple-iap-"));
  openssl(certDir, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key"]);
  openssl(certDir, [
    "req",
    "-x509",
    "-new",
    "-key",
    "root.key",
    "-subj",
    "/CN=Apple Test Root",
    "-days",
    "2",
    "-out",
    "root.pem",
  ]);
  openssl(certDir, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "leaf.key"]);
  openssl(certDir, [
    "req",
    "-new",
    "-key",
    "leaf.key",
    "-subj",
    "/CN=Apple Test Leaf",
    "-out",
    "leaf.csr",
  ]);
  openssl(certDir, [
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "root.pem",
    "-CAkey",
    "root.key",
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    "leaf.pem",
  ]);
  rootPem = readFileSync(join(certDir, "root.pem"), "utf-8");
  leafKeyPem = readFileSync(join(certDir, "leaf.key"), "utf-8");
  x5c = [
    new X509Certificate(readFileSync(join(certDir, "leaf.pem"), "utf-8")).raw.toString("base64"),
    new X509Certificate(rootPem).raw.toString("base64"),
  ];
};

const signJws = (payload: unknown): string => {
  const h = b64url(JSON.stringify({ alg: "ES256", x5c }));
  const p = b64url(JSON.stringify(payload));
  const signer = createSign("SHA256");
  signer.update(`${h}.${p}`);
  signer.end();
  return `${h}.${p}.${b64url(signer.sign({ key: leafKeyPem, dsaEncoding: "ieee-p1363" }))}`;
};

interface NotificationOpts {
  notificationType: string;
  subtype?: string;
  notificationUUID?: string;
  productId?: string;
  originalTransactionId?: string;
  expiresDateMs?: number;
  appAccountToken?: string;
}

const buildSignedPayload = (o: NotificationOpts): string => {
  const txInfo = {
    originalTransactionId: o.originalTransactionId ?? "1000000000",
    productId: o.productId ?? PREMIUM_PRODUCT,
    bundleId: BUNDLE_ID,
    ...(o.appAccountToken ? { appAccountToken: o.appAccountToken } : {}),
    ...(o.expiresDateMs ? { expiresDate: o.expiresDateMs } : {}),
  };
  const payload = {
    notificationType: o.notificationType,
    ...(o.subtype ? { subtype: o.subtype } : {}),
    notificationUUID: o.notificationUUID ?? randomUUID(),
    version: "2.0",
    data: { bundleId: BUNDLE_ID, environment: "Sandbox", signedTransactionInfo: signJws(txInfo) },
  };
  return signJws(payload);
};

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let app: any;
let prisma: any;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let userId: string;
let accessToken: string;

const postWebhook = (signedPayload: unknown) =>
  request(app)
    .post("/api/v1/webhooks/apple-iap")
    .set("Content-Type", "application/json")
    .send({ signedPayload });

const tierOf = async (): Promise<string> =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } })).tier;

beforeAll(async () => {
  makeChain();
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
  // Apple IAP config — read at env parse time, so set before app import.
  process.env.APPLE_ROOT_CA_PEM = rootPem;
  process.env.APPLE_IAP_SHARED_SECRET = "test_shared_secret";
  process.env.APPLE_BUNDLE_ID = BUNDLE_ID;
  process.env.APPLE_PRODUCT_ID_PREMIUM = PREMIUM_PRODUCT;
  process.env.APPLE_PRODUCT_ID_FAMILY = FAMILY_PRODUCT;

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('bp_readings', 'measured_at', if_not_exists => TRUE);",
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
      phone: "+919850000002",
      name: "ApplePayer",
      age: 60,
      householdId: household.id,
      onboardingComplete: true,
      tier: "free",
    },
  });
  userId = user.id;
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  await setFlag("payments_apple_iap_enabled", true, "test");
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
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

describe("POST /api/v1/webhooks/apple-iap — signature", () => {
  it("rejects an invalid JWS with 401 and changes no state", async () => {
    const before = await tierOf();
    const res = await postWebhook("not.a.valid.jws");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    expect(await tierOf()).toBe(before);
    expect(await prisma.paymentEvent.count()).toBe(0);
  });

  it("503s when payments_apple_iap_enabled is off", async () => {
    await setFlag("payments_apple_iap_enabled", false, "test");
    resetFlagCache();
    const res = await postWebhook(buildSignedPayload({ notificationType: "SUBSCRIBED" }));
    expect(res.status).toBe(503);
    await setFlag("payments_apple_iap_enabled", true, "test");
    resetFlagCache();
  });
});

describe("POST /api/v1/webhooks/apple-iap — tier transitions", () => {
  it("SUBSCRIBED upgrades to the purchased tier (via appAccountToken)", async () => {
    const res = await postWebhook(
      buildSignedPayload({
        notificationType: "SUBSCRIBED",
        productId: FAMILY_PRODUCT,
        appAccountToken: userId,
        originalTransactionId: "1000000001",
        expiresDateMs: Date.now() + 30 * 86_400_000,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("activate");
    expect(await tierOf()).toBe("family");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.provider).toBe("apple_iap");
    expect(sub.tier).toBe("family");
    expect(sub.providerSubscriptionId).toBe("1000000001");
  });

  it("is idempotent — replaying the same notificationUUID is a no-op", async () => {
    const uuid = randomUUID();
    const payload = buildSignedPayload({
      notificationType: "DID_RENEW",
      appAccountToken: userId,
      originalTransactionId: "1000000001",
      notificationUUID: uuid,
    });
    const first = await postWebhook(payload);
    expect(first.status).toBe(200);
    const countAfterFirst = await prisma.paymentEvent.count();
    const replay = await postWebhook(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);
    expect(await prisma.paymentEvent.count()).toBe(countAfterFirst);
  });

  it("EXPIRED downgrades to free and retains ALL patient health data", async () => {
    await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId,
        valueMgDl: 110,
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
        systolic: 128,
        diastolic: 82,
        source: "manual",
        measuredAt: new Date(),
      },
    });
    const glucoseBefore = await prisma.glucoseReading.count({ where: { userId } });
    const bpBefore = await prisma.bPReading.count({ where: { userId } });

    const res = await postWebhook(
      buildSignedPayload({
        notificationType: "EXPIRED",
        appAccountToken: userId,
        originalTransactionId: "1000000001",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("downgrade");
    expect(await tierOf()).toBe("free");

    expect(await prisma.glucoseReading.count({ where: { userId } })).toBe(glucoseBefore);
    expect(await prisma.bPReading.count({ where: { userId } })).toBe(bpBefore);
  });

  it("auto-renew-off keeps the tier and flags cancelAtPeriodEnd", async () => {
    // Re-activate first.
    await postWebhook(
      buildSignedPayload({
        notificationType: "SUBSCRIBED",
        appAccountToken: userId,
        originalTransactionId: "1000000001",
        expiresDateMs: Date.now() + 30 * 86_400_000,
      }),
    );
    expect(await tierOf()).toBe("premium");
    const res = await postWebhook(
      buildSignedPayload({
        notificationType: "DID_CHANGE_RENEWAL_STATUS",
        subtype: "AUTO_RENEW_DISABLED",
        appAccountToken: userId,
        originalTransactionId: "1000000001",
      }),
    );
    expect(res.status).toBe(200);
    expect(await tierOf()).toBe("premium");
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.status).toBe("cancelled");
  });
});

describe("POST /api/v1/payments/apple-iap/verify-receipt", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const appleResponse = (body: unknown) =>
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

  const verify = () =>
    request(app)
      .post("/api/v1/payments/apple-iap/verify-receipt")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ receiptData: "base64-receipt-blob" });

  it("validates a receipt with Apple and applies the tier (201)", async () => {
    // Reset to free first via an EXPIRED webhook so the upgrade is visible.
    await postWebhook(
      buildSignedPayload({
        notificationType: "EXPIRED",
        appAccountToken: userId,
        originalTransactionId: "1000000001",
      }),
    );
    globalThis.fetch = appleResponse({
      status: 0,
      receipt: { bundle_id: BUNDLE_ID },
      latest_receipt_info: [
        {
          product_id: PREMIUM_PRODUCT,
          original_transaction_id: "2000000000",
          expires_date_ms: String(Date.now() + 30 * 86_400_000),
        },
      ],
    });

    const res = await verify();
    expect(res.status).toBe(201);
    expect(res.body.data.tier).toBe("premium");
    expect(res.body.data.providerSubscriptionId).toBe("2000000000");
    expect(await tierOf()).toBe("premium");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toContain("buy.itunes.apple.com/verifyReceipt");
  });

  it("rejects an invalid receipt (Apple status != 0) with 400", async () => {
    globalThis.fetch = appleResponse({ status: 21002 });
    const res = await verify();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAYMENT_RECEIPT_INVALID");
  });

  it("rejects a receipt for an unknown product with 400", async () => {
    globalThis.fetch = appleResponse({
      status: 0,
      receipt: { bundle_id: BUNDLE_ID },
      latest_receipt_info: [
        { product_id: "com.swasth.unknown", original_transaction_id: "3", expires_date_ms: "0" },
      ],
    });
    const res = await verify();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PAYMENT_RECEIPT_INVALID");
  });

  it("503s when the flag is off (no Apple call made)", async () => {
    globalThis.fetch = appleResponse({ status: 0 });
    await setFlag("payments_apple_iap_enabled", false, "test");
    resetFlagCache();
    const res = await verify();
    expect(res.status).toBe(503);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    await setFlag("payments_apple_iap_enabled", true, "test");
    resetFlagCache();
  });

  it("requires auth", async () => {
    const res = await request(app)
      .post("/api/v1/payments/apple-iap/verify-receipt")
      .send({ receiptData: "x" });
    expect(res.status).toBe(401);
  });
});
