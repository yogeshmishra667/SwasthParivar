// Phase 3 Feature A integration test — chat with no Claude API key.
//
// Verifies the template-only degradation: when CLAUDE_API_KEY is unset,
// every chat turn must serve a Tier-1 template instead of reaching the
// Claude wrapper (which throws on a missing key and would 500). An
// open-ended question — which would normally route to Tier 3 — must
// come back with tier "template" and the Claude wrapper must never be
// called.
//
// Separate file from chat.test.ts because `env.ts` parses the
// environment once at import: this file must NOT set CLAUDE_API_KEY.

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import type { prisma as PrismaInstance } from "../../src/shared/database.js";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";

// Mock the Claude wrapper so the test can assert it is NEVER called.
vi.mock("../../src/shared/ai/claude.js", () => ({
  generateResponse: vi.fn(() => Promise.reject(new Error("Claude must not be called"))),
  __setClaudeClientForTests: () => undefined,
}));

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
let app: Express;
let prisma: typeof PrismaInstance;
let setFlag: typeof SetFlagFn;

let patientId: string;
let patientToken: string;

const PATIENT_PHONE = "+919812345740";

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
  // Deliberately unset — this test exercises the no-key path.
  delete process.env.CLAUDE_API_KEY;

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

  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: PATIENT_PHONE,
      name: "Ramesh",
      age: 65,
      householdId: household.id,
      conditions: ["diabetes"],
      onboardingComplete: true,
      // Day 30 — past the cold-start window so the tier router fires.
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    },
  });
  patientId = patient.id;
  patientToken = jwt.sign({ sub: patientId, householdId: household.id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  // Seed readings so an open_ended question would otherwise route to
  // Tier 3 (sonnet) rather than the sparse-data template fallback.
  for (let i = 0; i < 8; i += 1) {
    const measuredAt = new Date(Date.now() - (i + 1) * 86_400_000);
    await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId: patientId,
        valueMgDl: 120 + i,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        streakCreditedTo: measuredAt,
      },
    });
  }
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

beforeEach(async () => {
  await prisma.chatMessage.deleteMany({});
  await prisma.chatSession.deleteMany({});
  const cacheModule = await import("../../src/shared/redis.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  await cacheModule.redis.flushdb();
  flagsModule.__resetFlagCache();
  await setFlag("ai_chat_enabled", true, "test");
  await setFlag("ai_chat_tier3_enabled", true, "test");
});

const post = (body: Record<string, unknown>): request.Test =>
  request(app)
    .post("/api/v1/chat/message")
    .set("Authorization", `Bearer ${patientToken}`)
    .send(body);

describe("POST /api/v1/chat/message — no CLAUDE_API_KEY", () => {
  it("serves an open-ended question as a template instead of 500ing", async () => {
    const claudeModule = await import("../../src/shared/ai/claude.js");
    const mock = vi.mocked(claudeModule.generateResponse);
    mock.mockClear();

    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      // Open-ended intent — would route to Tier 3 if a key were set.
      message: "Tell me about my sugar today.",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.tier).toBe("template");
    expect(typeof res.body.data.content).toBe("string");
    expect(res.body.data.content.length).toBeGreaterThan(0);
    // The Claude wrapper must never be reached without a key.
    expect(mock).not.toHaveBeenCalled();
  });

  it("still answers a medication question with the doctor redirect", async () => {
    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "Should I increase my metformin dose?",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.tier).toBe("template");
    expect(res.body.data.content).toBe("Yeh sawaal doctor se poochna best rahega.");
  });
});
