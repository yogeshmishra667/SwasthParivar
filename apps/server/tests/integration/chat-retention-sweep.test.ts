// Phase 3 integration tests — CHAT_RETENTION_SWEEP processor (CC.11 §5).
//
// Exercises the weekly DPDP retention sweep against a real Postgres:
//   - flag-gated OFF by default (destructive job ships dark)
//   - archives ChatSessions older than 90 days
//   - hard-deletes ChatSessions older than 1 year (+ cascades messages)
//   - leaves recent sessions and already-archived sessions untouched
//
// Imports the processor directly (not the worker) so no BullMQ listener
// starts. Real Postgres + Redis via Testcontainers.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { prisma as PrismaInstance } from "../../src/shared/database.js";
import type { setFlag as SetFlagFn } from "../../src/shared/flags/index.js";
import type {
  processChatRetentionSweep as ProcessorFn,
  ChatRetentionSweepJob,
} from "../../src/workers/chat-retention-sweep.processor.js";

const DAY_MS = 86_400_000;

const runPrisma = (args: string[]): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed (status ${result.status})`);
  }
};

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let prisma: typeof PrismaInstance;
let setFlag: typeof SetFlagFn;
let resetFlagCache: () => void;
let processChatRetentionSweep: typeof ProcessorFn;

let userId: string;

// The processor never reads the job payload — a bare stub is enough.
const job = { id: "test" } as unknown as Job<ChatRetentionSweepJob>;

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

  runPrisma(["migrate", "deploy"]);

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const processorModule = await import("../../src/workers/chat-retention-sweep.processor.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  processChatRetentionSweep = processorModule.processChatRetentionSweep;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: "+919812345799",
      name: "Ramesh",
      age: 65,
      householdId: household.id,
      conditions: ["diabetes"],
      onboardingComplete: true,
    },
  });
  userId = user.id;
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
  await cacheModule.redis.flushdb();
  resetFlagCache();
});

const makeSession = (ageDays: number, archivedAt?: Date): Promise<{ id: string }> =>
  prisma.chatSession.create({
    data: {
      userId,
      language: "hi",
      startedAt: new Date(Date.now() - ageDays * DAY_MS),
      ...(archivedAt ? { archivedAt } : {}),
    },
    select: { id: true },
  });

describe("CHAT_RETENTION_SWEEP processor", () => {
  it("is a no-op when chat_retention_sweep_enabled is off (default)", async () => {
    const old = await makeSession(400);
    await processChatRetentionSweep(job);
    const still = await prisma.chatSession.findUnique({ where: { id: old.id } });
    expect(still).not.toBeNull();
    expect(still?.archivedAt).toBeNull();
  });

  it("archives sessions older than 90 days, leaves recent ones untouched", async () => {
    await setFlag("chat_retention_sweep_enabled", true, "test");
    resetFlagCache();
    const recent = await makeSession(30);
    const stale = await makeSession(100);

    await processChatRetentionSweep(job);

    const recentRow = await prisma.chatSession.findUnique({ where: { id: recent.id } });
    const staleRow = await prisma.chatSession.findUnique({ where: { id: stale.id } });
    expect(recentRow?.archivedAt).toBeNull();
    expect(staleRow?.archivedAt).not.toBeNull();
  });

  it("hard-deletes sessions older than 1 year and cascades their messages", async () => {
    await setFlag("chat_retention_sweep_enabled", true, "test");
    resetFlagCache();
    const old = await makeSession(400);
    await prisma.chatMessage.create({
      data: {
        clientUuid: randomUUID(),
        version: 1,
        sessionId: old.id,
        userId,
        role: "assistant",
        content: "stale chat content",
        language: "hi",
        costTier: "template",
      },
    });

    await processChatRetentionSweep(job);

    const sessionRow = await prisma.chatSession.findUnique({ where: { id: old.id } });
    const messageCount = await prisma.chatMessage.count({ where: { sessionId: old.id } });
    expect(sessionRow).toBeNull();
    expect(messageCount).toBe(0);
  });

  it("does not re-stamp a session that is already archived", async () => {
    await setFlag("chat_retention_sweep_enabled", true, "test");
    resetFlagCache();
    const originalArchivedAt = new Date(Date.now() - 25 * DAY_MS);
    const archived = await makeSession(120, originalArchivedAt);

    await processChatRetentionSweep(job);

    const row = await prisma.chatSession.findUnique({ where: { id: archived.id } });
    expect(row?.archivedAt?.getTime()).toBe(originalArchivedAt.getTime());
  });
});
