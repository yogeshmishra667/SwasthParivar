// Phase 3 CC.12.4 integration tests — GET /api/v1/config/features.
//
// Verifies the feature-config endpoint resolves the CC.12 rollout gate
// per calling user: global booleans, cohort allowlist, percentage
// edges. The endpoint touches Redis only (flag service) — no Postgres,
// so the suite runs with a stub DATABASE_URL like admin-flags.test.ts.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

const JWT_SECRET = "test-secret-test-secret-test-secret-123";
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

let redisContainer: StartedRedisContainer;
let app: Express;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let patientToken: string;

beforeAll(async () => {
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:65432/stub";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";

  const appModule = await import("../../src/app.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;

  patientToken = jwt.sign({ sub: PATIENT_ID, householdId: "hh-1" }, JWT_SECRET, {
    expiresIn: "1h",
  });
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

const getFeatures = (token = patientToken): request.Test =>
  request(app).get("/api/v1/config/features").set("Authorization", `Bearer ${token}`);

describe("GET /api/v1/config/features — auth", () => {
  it("401s without a bearer token", async () => {
    const res = await request(app).get("/api/v1/config/features");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });
});

describe("GET /api/v1/config/features — rollout resolution", () => {
  it("reports ai_chat false when the flag is unset (fail-safe default)", async () => {
    const res = await getFeatures();
    expect(res.status).toBe(200);
    expect(res.body.data.features).toEqual({ ai_chat: false });
  });

  it("reports ai_chat true for a global-on boolean flag", async () => {
    await setFlag("ai_chat_enabled", true, "test");
    const res = await getFeatures();
    expect(res.body.data.features.ai_chat).toBe(true);
  });

  it("reports ai_chat false for a global-off boolean flag", async () => {
    await setFlag("ai_chat_enabled", false, "test");
    const res = await getFeatures();
    expect(res.body.data.features.ai_chat).toBe(false);
  });

  it("enables ai_chat for a user inside a cohort allowlist", async () => {
    await setFlag("ai_chat_enabled", { rollout: "cohort", userIds: [PATIENT_ID] }, "test");
    const res = await getFeatures();
    expect(res.body.data.features.ai_chat).toBe(true);
  });

  it("keeps ai_chat off for a user outside the cohort allowlist", async () => {
    await setFlag("ai_chat_enabled", { rollout: "cohort", userIds: [OTHER_ID] }, "test");
    const res = await getFeatures();
    expect(res.body.data.features.ai_chat).toBe(false);
  });

  it("resolves a 100% rollout as on and a 0% rollout as off", async () => {
    await setFlag("ai_chat_enabled", { rollout: "percentage", percent: 100 }, "test");
    resetFlagCache();
    expect((await getFeatures()).body.data.features.ai_chat).toBe(true);

    await setFlag("ai_chat_enabled", { rollout: "percentage", percent: 0 }, "test");
    resetFlagCache();
    expect((await getFeatures()).body.data.features.ai_chat).toBe(false);
  });
});
