// Phase 3 Feature A integration tests — /api/v1/chat.
//
// Covers the 12-step service flow end-to-end per phase3.md A.8:
//   - Flag gate (ai_chat_enabled off → 503)
//   - Idempotent replay (same clientUuid + version → no new Claude call)
//   - Rate limit (free tier 3/day)
//   - Emergency skip (critical-bypass within 30 min)
//   - Tier 1 routing (no Claude call)
//   - Tier 3 routing with mocked Claude + safety filter rejection
//   - User-initiated flag endpoint
//   - Session listing
//
// `@anthropic-ai/sdk` is mocked at module level so the wrapper never
// reaches the real API. Real Postgres + Redis via Testcontainers.

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

// Holds the latest mocked-response config so tests can override the
// Claude wrapper's behaviour without re-mocking the module.
const claudeOverride: {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  throws?: Error | undefined;
} = {
  content: "Aapki sugar 120 hai — achchi range mein.",
  tokensInput: 500,
  tokensOutput: 50,
};

// Mock the Claude wrapper at module level. Returns the configured
// payload — overridden per test via claudeOverride mutation.
vi.mock("../../src/shared/ai/claude.js", () => ({
  generateResponse: vi.fn(() => {
    if (claudeOverride.throws) return Promise.reject(claudeOverride.throws);
    return Promise.resolve({
      content: claudeOverride.content,
      model: "claude-haiku-4-5",
      tokensInput: claudeOverride.tokensInput,
      tokensOutput: claudeOverride.tokensOutput,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      responseLatencyMs: 50,
    });
  }),
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

const PATIENT_PHONE = "+919812345710";

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
  process.env.CLAUDE_API_KEY = "test-key";

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

  // Seed enough readings so the cost router goes past the "sparse data"
  // template fallback and into Tier 3 (sonnet) for open_ended intents.
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
  // Reset per-test state. ORDER MATTERS:
  //   1. flushdb wipes ALL Redis keys, including any flag the previous
  //      test set + the daily rate counter.
  //   2. __resetFlagCache drops the in-process getFlag cache so the
  //      next read goes back to Redis.
  //   3. THEN setFlag writes the test flag (after flushdb, so it survives).
  await prisma.chatMessage.deleteMany({});
  await prisma.chatSession.deleteMany({});
  await prisma.feedbackEvent.deleteMany({});
  const cacheModule = await import("../../src/shared/redis.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  await cacheModule.redis.flushdb();
  flagsModule.__resetFlagCache();
  await setFlag("ai_chat_enabled", true, "test");
  await setFlag("ai_chat_tier3_enabled", true, "test");
  // Restore default mocked content.
  claudeOverride.content = "Aapki sugar 120 hai — achchi range mein.";
  claudeOverride.tokensInput = 500;
  claudeOverride.tokensOutput = 50;
  claudeOverride.throws = undefined;
});

const post = (body: Record<string, unknown>, token = patientToken): request.Test =>
  request(app).post("/api/v1/chat/message").set("Authorization", `Bearer ${token}`).send(body);

describe("POST /api/v1/chat/message — flag gate", () => {
  it("503s when ai_chat_enabled is false", async () => {
    await setFlag("ai_chat_enabled", false, "test");
    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "Hello",
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CHAT_DISABLED");
  });
});

describe("POST /api/v1/chat/message — idempotency", () => {
  it("replays the same response on a retry with the same clientUuid + version", async () => {
    const clientUuid = randomUUID();
    const first = await post({ client_uuid: clientUuid, version: 1, message: "Hi" });
    expect(first.status).toBe(201);
    const replay = await post({ client_uuid: clientUuid, version: 1, message: "Hi" });
    expect(replay.status).toBe(201);
    expect(replay.body.data.messageId).toBe(first.body.data.messageId);
    expect(replay.body.data.content).toBe(first.body.data.content);
  });

  it("rejects a stale lower version with READING_STALE_VERSION", async () => {
    const clientUuid = randomUUID();
    await post({ client_uuid: clientUuid, version: 2, message: "First" });
    const stale = await post({
      client_uuid: clientUuid,
      version: 1,
      message: "Second (stale)",
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("READING_STALE_VERSION");
  });
});

describe("POST /api/v1/chat/message — rate limit", () => {
  it("429s after CHAT_DAILY_FREE_LIMIT successful sends in a day", async () => {
    // Default env is 3. Four distinct clientUuids → fourth must 429.
    for (let i = 0; i < 3; i += 1) {
      const res = await post({
        client_uuid: randomUUID(),
        version: 1,
        message: `msg ${i}`,
      });
      expect(res.status).toBe(201);
    }
    const fourth = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "fourth",
    });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe("CHAT_RATE_LIMITED");
  });
});

describe("POST /api/v1/chat/message — emergency skip", () => {
  it("returns the canned redirect when a critical-bypass fired in last 30 min", async () => {
    await prisma.feedbackEvent.create({
      data: {
        userId: patientId,
        feedbackType: "critical_warn",
        tone: "gentle_warn",
        messageKey: "critical.high",
        variantIndex: 0,
        messageParams: {},
        shownAt: new Date(),
      },
    });
    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "How am I doing?",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.emergencySkipped).toBe(true);
    expect(res.body.data.content).toMatch(/critical alert|Doctor/i);
  });
});

describe("POST /api/v1/chat/message — Tier 1 routing", () => {
  it("medication question always returns the doctor redirect (no Claude call)", async () => {
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

describe("POST /api/v1/chat/message — safety filter rejection", () => {
  it("replaces unsafe Claude output with the safety redirect + flags the row", async () => {
    // Configure the mocked Claude to produce an explicit dose-change
    // directive — the Post-Response Safety Filter must catch it.
    claudeOverride.content = "Increase your metformin dose to 1000mg.";
    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      // Open-ended intent so the router goes Tier 3 (Claude).
      message: "Tell me about my sugar today.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.flagged).toBe(true);
    expect(res.body.data.content).toBe("Yeh sawaal doctor se poochna best rahega.");
    expect(res.body.data.safetyViolations.length).toBeGreaterThan(0);

    // Verify the row was persisted with flagged=true.
    const stored = await prisma.chatMessage.findFirst({
      where: { id: res.body.data.messageId },
      select: { flagged: true, flagReason: true, safetyViolations: true },
    });
    expect(stored?.flagged).toBe(true);
    expect(stored?.flagReason).toBe("safety_filter_rejected");
  });
});

describe("POST /api/v1/chat/message — happy path Tier 3", () => {
  it("uses Claude response when output is safe", async () => {
    const res = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "Tell me about my sugar today.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.flagged).toBe(false);
    expect(res.body.data.content).toMatch(/sugar 120/);
    expect(["cached", "sonnet"]).toContain(res.body.data.tier);
  });
});

describe("POST /api/v1/chat/messages/:id/flag", () => {
  it("marks the message as user-flagged", async () => {
    const send = await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "Tell me about my sugar today.",
    });
    const id = send.body.data.messageId;

    const flag = await request(app)
      .post(`/api/v1/chat/messages/${id}/flag`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ reason: "wrong_info" });
    expect(flag.status).toBe(200);
    expect(flag.body.data.flagged).toBe(true);

    const stored = await prisma.chatMessage.findFirst({
      where: { id },
      select: { flagged: true, flagReason: true },
    });
    expect(stored?.flagged).toBe(true);
    expect(stored?.flagReason).toMatch(/user_flagged|safety_filter_rejected/);
  });
});

describe("GET /api/v1/chat/sessions", () => {
  it("lists the patient's recent sessions", async () => {
    await post({
      client_uuid: randomUUID(),
      version: 1,
      message: "Tell me about my sugar today.",
    });
    const list = await request(app)
      .get("/api/v1/chat/sessions")
      .set("Authorization", `Bearer ${patientToken}`)
      .query({ limit: 10 });
    expect(list.status).toBe(200);
    expect(list.body.data.data.length).toBeGreaterThanOrEqual(1);
  });
});
