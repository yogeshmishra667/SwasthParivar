// Phase 4 Feature G.4 — generateReportSummary safety + gating.
//
// The clinician-facing AI summary goes through the SAME post-response
// safety filter as patient chat. This suite injects a fake Anthropic
// client and asserts: disabled flag short-circuits, a safe summary
// passes, and a summary containing a dosage directive is DROPPED (the
// PDF would render without the paragraph). Redis only — no DB needed
// (the flag service is Redis-backed and the wrapper never touches Prisma).

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type {
  ReportSummaryInput,
  ReportSummaryResult,
} from "../../src/shared/ai/report-summary.js";

let redisContainer: StartedRedisContainer;
let generateReportSummary: (input: ReportSummaryInput) => Promise<ReportSummaryResult>;
let setReportClient: (client: any) => void;
let setFlag: (key: string, value: boolean, actor: string) => Promise<unknown>;
let resetFlagCache: () => void;

// Minimal Anthropic-client stub: one messages.create returning a fixed
// text block + usage. `reply` is swapped per test.
let reply = "";
const fakeClient = {
  messages: {
    create: () =>
      Promise.resolve({
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 200, output_tokens: 80 },
      }),
  },
} as any;

beforeAll(async () => {
  redisContainer = await new RedisContainer("redis:7-alpine").start();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
  process.env.DATABASE_URL = "postgresql://localhost:5432/unused";
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";

  const mod = await import("../../src/shared/ai/report-summary.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  generateReportSummary = mod.generateReportSummary;
  setReportClient = mod.__setReportClientForTests;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
}, 120_000);

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
  setReportClient(fakeClient);
  await setFlag("report_generation_enabled", true, "test");
  resetFlagCache();
});

describe("generateReportSummary", () => {
  it("short-circuits to null when report_generation_enabled is off", async () => {
    await setFlag("report_generation_enabled", false, "test");
    resetFlagCache();
    const res = await generateReportSummary({ userId: "u1", language: "en", digest: "data" });
    expect(res).toEqual({ text: null, reason: "disabled" });
  });

  it("returns a safe summary unchanged", async () => {
    reply = "Glucose has been stable this month; discuss the morning readings.";
    const res = await generateReportSummary({ userId: "u1", language: "en", digest: "data" });
    expect(res.reason).toBe("ok");
    expect(res.text).toBe(reply);
  });

  it("DROPS a summary that contains a dosage directive (safety filter)", async () => {
    reply = "Increase metformin to 1000 mg twice daily and stop taking aspirin.";
    const res = await generateReportSummary({ userId: "u1", language: "en", digest: "data" });
    expect(res.text).toBeNull();
    expect(res.reason).toBe("safety_rejected");
  });

  it("returns error-null when the model yields empty text", async () => {
    reply = "   ";
    const res = await generateReportSummary({ userId: "u1", language: "en", digest: "data" });
    expect(res.text).toBeNull();
    expect(res.reason).toBe("error");
  });
});
