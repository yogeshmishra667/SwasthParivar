// Verifies the defaultRateLimit middleware keys by JWT subject when one
// is verifiable, falling back to IP otherwise. Without this, every
// patient behind one carrier-NAT IP would share a single quota with
// every other patient — and an ops tightening of `rate_limit.default.free`
// during an incident could mass-throttle real patients.
//
// Redis-only test (no postgres). Uses a stub DATABASE_URL because the
// middleware runs before any route handler that touches the DB; we
// expect 401 on the routes themselves (auth fails since the test users
// don't exist), but the rate-limit decision happens upstream and is
// observable via 429 vs non-429.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

let redisContainer: StartedRedisContainer;
let app: Express;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;

const JWT_SECRET = "test-secret-test-secret-test-secret-123";

const signUserToken = (sub: string): string =>
  jwt.sign({ sub, householdId: randomUUID() }, JWT_SECRET, { expiresIn: "1h" });

// Any authenticated route that runs AFTER the global defaultRateLimit.
// We don't care that auth fails (the test users don't exist in the stub
// DB) — we only care that the rate-limit middleware *upstream of auth*
// either lets the request through (any 4xx that isn't 429) or blocks it
// with 429.
const HIT_ROUTE = "/api/v1/streaks/current";

const hit = async (token?: string): Promise<request.Response> => {
  const req = request(app).get(HIT_ROUTE);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return await req;
};

beforeAll(async () => {
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:65432/stub";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";
  process.env.ADMIN_JWT_SECRET = "test-admin-secret-test-admin-secret-123";

  const appModule = await import("../../src/app.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
}, 60_000);

afterAll(async () => {
  try {
    const cacheModule = await import("../../src/shared/redis.js");
    if (cacheModule.redis) await cacheModule.redis.quit();
  } catch {
    /* ignore */
  }
  if (redisContainer) await redisContainer.stop();
});

describe("defaultRateLimit — keyed by JWT subject, IP fallback", () => {
  it("each authenticated user gets an isolated quota (proves per-user keying)", async () => {
    await setFlag("rate_limit.default.free", 2, "test");
    resetFlagCache();

    const tokenA = signUserToken(`A-${randomUUID()}`);
    const tokenB = signUserToken(`B-${randomUUID()}`);

    // User A burns the quota.
    const a1 = await hit(tokenA);
    expect(a1.status).not.toBe(429);
    const a2 = await hit(tokenA);
    expect(a2.status).not.toBe(429);
    const a3 = await hit(tokenA);
    expect(a3.status).toBe(429);

    // User B — same supertest source IP (127.0.0.1) but a different
    // JWT subject. If the rate-limit middleware were still keyed by IP
    // alone, B would also be at the limit. Per-user keying gives B a
    // fresh bucket.
    const b1 = await hit(tokenB);
    expect(b1.status).not.toBe(429);
    const b2 = await hit(tokenB);
    expect(b2.status).not.toBe(429);

    // And B still hits the limit on its own quota:
    const b3 = await hit(tokenB);
    expect(b3.status).toBe(429);
  });

  it("invalid Bearer token falls back to IP key (does NOT get a fresh quota)", async () => {
    await setFlag("rate_limit.default.free", 2, "test");
    resetFlagCache();

    // First two unauthenticated hits burn the IP-keyed quota.
    const ip1 = await hit();
    expect(ip1.status).not.toBe(429);
    const ip2 = await hit();
    expect(ip2.status).not.toBe(429);
    const ip3 = await hit();
    expect(ip3.status).toBe(429);

    // A request with a malformed Bearer token must fall through to the
    // IP key — not magically receive a fresh quota — or attackers could
    // bypass the cap by spamming garbage tokens.
    const garbage = await hit("not.a.valid.jwt");
    expect(garbage.status).toBe(429);
  });
});
