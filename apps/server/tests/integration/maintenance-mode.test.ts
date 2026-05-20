// Phase 3 CC.12.7 #1 integration tests — maintenance-mode middleware.
//
// Verifies the global 503 kill switch and, critically, its exemptions:
// /health (orchestrator probes) and /admin (so ops can lift maintenance
// mode) must stay reachable while maintenance is ON. Redis-only, like
// admin-flags.test.ts.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import type { Express } from "express";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

let redisContainer: StartedRedisContainer;
let app: Express;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;

beforeAll(async () => {
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:65432/stub";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";
  process.env.ADMIN_API_TOKEN = "admin-token-admin-token-admin-token-12";

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

beforeEach(async () => {
  const cacheModule = await import("../../src/shared/redis.js");
  await cacheModule.redis.flushdb();
  resetFlagCache();
});

describe("maintenance-mode middleware", () => {
  it("lets feature routes through when maintenance_mode is off", async () => {
    // No flag set → default false. The request reaches the router and
    // is rejected by requireAuth (401) — NOT the maintenance gate.
    const res = await request(app).get("/api/v1/config/features");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("503s feature routes when maintenance_mode is on", async () => {
    await setFlag("maintenance_mode", true, "test");
    resetFlagCache();
    const res = await request(app).get("/api/v1/config/features");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MAINTENANCE_MODE");
  });

  it("keeps /health reachable during maintenance (probe exemption)", async () => {
    await setFlag("maintenance_mode", true, "test");
    resetFlagCache();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("keeps /admin reachable during maintenance (recovery exemption)", async () => {
    await setFlag("maintenance_mode", true, "test");
    resetFlagCache();
    // No admin token → 401 from adminAuth. The point: it is NOT a 503
    // MAINTENANCE_MODE — ops can still reach the flag API to recover.
    const res = await request(app).get("/admin/flags");
    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe("MAINTENANCE_MODE");
  });
});
