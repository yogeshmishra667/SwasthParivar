import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type * as FlagsModuleType from "../../src/shared/flags/index.js";

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
let app: any;
let prisma: any;
let accessToken: string;
const TEST_PHONE = "+919812345678";

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
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Test Patient",
      age: 55,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}, 120_000);

afterAll(async () => {
  // Close every client BEFORE stopping the containers so we don't leave
  // open sockets that explode with FATAL 57P01 on container shutdown.
  // `disconnectDatabase` calls `prisma.$disconnect()` AND `pool.end()` —
  // the bare `prisma.$disconnect()` does not end the underlying pg.Pool
  // because the adapter was given an externally-created pool.
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

describe("POST /api/v1/readings/glucose", () => {
  it("saves a reading and returns streak + feedback", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 110,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reading.valueMgDl).toBe(110);
    expect(res.body.data.streak.currentStreakDays).toBeGreaterThanOrEqual(1);
    expect(res.body.data.feedback).toBeDefined();
    expect(res.body.data.critical.isCritical).toBe(false);
  });

  it("rejects strictly-older version with READING_STALE_VERSION", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 100,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(first.status).toBe(201);

    const stale = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 100,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 1,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("READING_STALE_VERSION");
  });

  it("treats same {clientUuid, version} replay as idempotent (200, single row, no duplicate side effects)", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Idempotency Tester",
        age: 60,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    const token = jwt.sign(
      { sub: user.id, householdId: user.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    const clientUuid = randomUUID();
    const payload = {
      clientUuid,
      valueMgDl: 118,
      readingType: "fasting" as const,
      context: "normal" as const,
      source: "manual" as const,
      measuredAt: new Date().toISOString(),
      version: 1,
    };

    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(first.status).toBe(201);
    const firstReadingId = first.body.data.reading.id;

    // Replay the same call — must succeed, return the same reading id, no second row.
    const replay = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body.success).toBe(true);
    expect(replay.body.data.reading.id).toBe(firstReadingId);
    expect(replay.body.data.reading.valueMgDl).toBe(118);

    // Single row in DB.
    const rows = await prisma.glucoseReading.findMany({ where: { clientUuid } });
    expect(rows).toHaveLength(1);

    // Feedback events: exactly ONE event for this reading (replay must not re-create).
    const feedbackEvents = await prisma.feedbackEvent.findMany({
      where: { readingId: firstReadingId },
    });
    expect(feedbackEvents).toHaveLength(1);
  });

  it("accepts version bump on same clientUuid as an edit", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    const first = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 120,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 1,
      });
    expect(first.status).toBe(201);

    const edited = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 125,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(edited.status).toBe(201);
    expect(edited.body.data.reading.valueMgDl).toBe(125);

    const rows = await prisma.glucoseReading.findMany({ where: { clientUuid } });
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(2);
  });

  it("flags critical=true for glucose < 65", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(true);
    expect(res.body.data.critical.severity).toBe("low");
    expect(res.body.data.critical.showFullscreenAlert).toBe(true);
  });

  it("enqueues a critical-alert job when value is below the low threshold", async () => {
    // Use a fresh user so we don't run into the 30-min server-side critical
    // cooldown left over from prior tests in this file.
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Critical Probe",
        age: 60,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    const token = jwt.sign(
      { sub: user.id, householdId: user.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    const queueModule = await import("../../src/shared/queue.js");
    const { Queue } = await import("bullmq");
    const { Redis } = await import("ioredis");
    const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const probeQueue = new Queue(queueModule.QUEUE_NAMES.CRITICAL_ALERT, { connection: conn });

    try {
      const postRes = await request(app)
        .post("/api/v1/readings/glucose")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          valueMgDl: 48,
          readingType: "fasting",
          context: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
          version: 1,
        });
      expect(postRes.body.data.critical.isCritical).toBe(true);

      // BullMQ's `add()` resolves before Redis confirms persistence in some
      // versions, so we poll briefly across all relevant queue states.
      const readingId = postRes.body.data.reading.id;
      let foundForReading = false;
      for (let attempt = 0; attempt < 20 && !foundForReading; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundForReading = jobs.some((j) => j.data?.readingId === readingId);
        if (!foundForReading) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundForReading).toBe(true);
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  });

  it("persists anti-cheat flags after enough same-value readings exist", async () => {
    // The streak engine flags `same_value_3_consecutive` when at least 3
    // *prior* same-type readings share the value. The flag therefore lands
    // on the **fourth** save, not the third. Use a fresh user so the
    // streak history is clean.
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Anti Cheat Tester",
        age: 60,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    const token = jwt.sign(
      { sub: user.id, householdId: user.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    const value = 142;
    const dayStart = new Date();
    // Insert 4 readings — flag should raise on the fourth.
    let lastReadingId: string | undefined;
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/v1/readings/glucose")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          valueMgDl: value,
          readingType: "fasting",
          context: "normal",
          source: "manual",
          // Slight stagger so measuredAt + clientUuid composite is unique.
          measuredAt: new Date(dayStart.getTime() - (3 - i) * 5 * 60_000).toISOString(),
          version: 1,
        });
      lastReadingId = res.body.data.reading.id;
    }
    const flagged = await prisma.glucoseReading.findFirst({
      where: { id: lastReadingId, userId: user.id },
    });
    expect(flagged).not.toBeNull();
    expect(flagged.antiCheatFlags).toContain("same_value_3_consecutive");
  });

  it("falls back to server time for streak credit after 2 anomalous client clocks", async () => {
    // Create a fresh user so the global anomaly counter starts at 0.
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Anomaly Tester",
        age: 60,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    const token = jwt.sign(
      { sub: user.id, householdId: user.householdId },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    // Each measuredAt is 5 hours in the past (> 2hr threshold).
    const sendAnomalous = async (): Promise<{ status: number; serverTimeUsed: boolean }> => {
      const res = await request(app)
        .post("/api/v1/readings/glucose")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          valueMgDl: 105,
          readingType: "fasting",
          context: "normal",
          source: "manual",
          measuredAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
          version: 1,
        });
      const reading = await prisma.glucoseReading.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        status: res.status,
        serverTimeUsed: reading?.streakCreditedAtServerTime ?? false,
      };
    };

    const first = await sendAnomalous();
    // First anomalous reading bumps count to 1 — not yet at threshold.
    expect(first.serverTimeUsed).toBe(false);

    const second = await sendAnomalous();
    // Second anomalous reading bumps count to 2 — fallback engages.
    expect(second.serverTimeUsed).toBe(true);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed?.timeAnomalyCount).toBeGreaterThanOrEqual(2);
  });
});

describe("POST /api/v1/readings/glucose — daily rate limit (rate_limit.readings.free)", () => {
  // A fresh user per scenario so the per-day Redis counter starts at zero
  // independent of the file's shared `accessToken`. We exercise the admin
  // flag path end-to-end: set the flag low → 2nd save trips RATE_LIMITED;
  // a critical-bypass value (< 65) saves regardless.
  const setupFreshUser = async (
    flagsModule: typeof FlagsModuleType,
  ): Promise<{ token: string; userId: string }> => {
    const household = await prisma.household.create({ data: {} });
    const u = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(Math.random() * 1e10)
          .toString()
          .slice(0, 8)}`,
        name: "Rate Limit Test",
        age: 60,
        householdId: household.id,
        onboardingComplete: true,
        tier: "free",
      },
    });
    const token = jwt.sign({ sub: u.id, householdId: u.householdId }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
    // Reset Redis counter for the new user (defensive — different UUID each
    // time but the key namespace is shared).
    const cacheModule = await import("../../src/shared/redis.js");
    await cacheModule.redis.del(`readings:rate:${u.id}:${new Date().toISOString().slice(0, 10)}`);
    flagsModule.__resetFlagCache();
    return { token, userId: u.id };
  };

  const postGlucose = async (
    token: string,
    valueMgDl: number,
    measuredAt: Date = new Date(),
  ): Promise<request.Response> => {
    return await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: measuredAt.toISOString(),
        version: 1,
      });
  };

  // Audit P9: the cap counts the day a reading was TAKEN on. Before the
  // fix it counted the day it reached the server, so a phone draining a
  // week-long offline backlog hit 429 on today's cap and the app deleted
  // the rest of the backlog.
  it("an offline backlog counts against the days it was taken on, not today", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("rate_limit.readings.free", 1, "test");
    flagsModule.__resetFlagCache();

    const { token } = await setupFreshUser(flagsModule);
    const now = Date.now();
    const twoDaysAgo = new Date(now - 48 * 3_600_000);
    const yesterday = new Date(now - 24 * 3_600_000);

    // A backlog synced today: one reading for each past day, then today's.
    expect((await postGlucose(token, 110, twoDaysAgo)).status).toBe(201);
    expect((await postGlucose(token, 112, yesterday)).status).toBe(201);
    expect((await postGlucose(token, 114)).status).toBe(201);

    // Each day still holds to the ceiling.
    const secondYesterday = await postGlucose(token, 116, yesterday);
    expect(secondYesterday.status).toBe(429);
    expect(secondYesterday.body.error.code).toBe("RATE_LIMITED");

    await flagsModule.setFlag("rate_limit.readings.free", 20, "test");
    flagsModule.__resetFlagCache();
  });

  // Audit P9 review C1: WatermelonDB stores an unset optional column as
  // null, so every reading the app queued offline drained with
  // `"notes": null`. That 400'd, and app builds before P9 delete a queued
  // row on any 4xx — every offline reading, critical ones included.
  it("accepts the offline queue's `notes: null` body (and stores no note)", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    const { token } = await setupFreshUser(flagsModule);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 52,
        readingType: "fasting",
        context: "normal",
        notes: null,
        source: "manual",
        measuredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(true);
    const stored = await prisma.glucoseReading.findFirst({
      where: { id: res.body.data.reading.id },
    });
    expect(stored?.notes).toBeNull();
  });

  // The app tells the two 429s apart by body: the daily cap is JSON
  // `RATE_LIMITED` (keep the row, try the next one), the per-minute limiter
  // is express-rate-limit's plain text (stop the drain, retry later). If the
  // limiter ever gets the JSON envelope, the app would treat it as the cap.
  it("the per-minute limiter's 429 is not the daily cap's RATE_LIMITED body", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    const { token } = await setupFreshUser(flagsModule);
    await flagsModule.setFlag("rate_limit.default.free", 1, "test");
    flagsModule.__resetFlagCache();

    try {
      await request(app).get("/api/v1/streaks/current").set("Authorization", `Bearer ${token}`);
      const limited = await request(app)
        .get("/api/v1/streaks/current")
        .set("Authorization", `Bearer ${token}`);

      expect(limited.status).toBe(429);
      expect(limited.body?.error?.code).not.toBe("RATE_LIMITED");
    } finally {
      await flagsModule.setFlag("rate_limit.default.free", 100, "test");
      flagsModule.__resetFlagCache();
    }
  });

  it("a reading dated in the future counts against today, not a fresh day", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("rate_limit.readings.free", 1, "test");
    flagsModule.__resetFlagCache();

    const { token } = await setupFreshUser(flagsModule);

    expect((await postGlucose(token, 110)).status).toBe(201);
    const future = await postGlucose(token, 120, new Date(Date.now() + 30 * 3_600_000));
    expect(future.status).toBe(429);
    expect(future.body.error.code).toBe("RATE_LIMITED");

    await flagsModule.setFlag("rate_limit.readings.free", 20, "test");
    flagsModule.__resetFlagCache();
  });

  it("free-tier patient — second save trips RATE_LIMITED when admin sets ceiling=1", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("rate_limit.readings.free", 1, "test");
    flagsModule.__resetFlagCache();

    const { token } = await setupFreshUser(flagsModule);

    const first = await postGlucose(token, 110);
    expect(first.status).toBe(201);

    const second = await postGlucose(token, 120);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
    expect(second.body.error.message).toContain("1");

    // Restore default so other tests in this run aren't affected.
    await flagsModule.setFlag("rate_limit.readings.free", 20, "test");
    flagsModule.__resetFlagCache();
  });

  it("critical-bypass value (< 65) saves even when over the rate limit", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("rate_limit.readings.free", 1, "test");
    flagsModule.__resetFlagCache();

    const { token } = await setupFreshUser(flagsModule);

    // Burn the daily quota with one non-critical save.
    const first = await postGlucose(token, 110);
    expect(first.status).toBe(201);

    // Critical-low (< 65) must still go through — medical safety overrides.
    const criticalLow = await postGlucose(token, 55);
    expect(criticalLow.status).toBe(201);
    expect(criticalLow.body.data.critical.isCritical).toBe(true);

    // Critical-high (> 315) — same rule.
    const criticalHigh = await postGlucose(token, 350);
    expect(criticalHigh.status).toBe(201);
    expect(criticalHigh.body.data.critical.isCritical).toBe(true);

    await flagsModule.setFlag("rate_limit.readings.free", 20, "test");
    flagsModule.__resetFlagCache();
  });

  it("premium-tier patient — rate limit does not apply", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("rate_limit.readings.free", 1, "test");
    flagsModule.__resetFlagCache();

    const { token, userId } = await setupFreshUser(flagsModule);
    await prisma.user.update({ where: { id: userId }, data: { tier: "premium" } });

    const first = await postGlucose(token, 110);
    expect(first.status).toBe(201);
    const second = await postGlucose(token, 120);
    expect(second.status).toBe(201);

    await flagsModule.setFlag("rate_limit.readings.free", 20, "test");
    flagsModule.__resetFlagCache();
  });
});

describe("POST /api/v1/sync/push", () => {
  it("reports per-row stale status for outdated version", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();

    const firstPush = await request(app)
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        changes: {
          glucoseReadings: [
            {
              clientUuid,
              valueMgDl: 120,
              readingType: "fasting",
              context: "normal",
              source: "manual",
              measuredAt,
              version: 3,
            },
          ],
        },
      });
    expect(firstPush.status).toBe(200);
    expect(firstPush.body.data.results[0].status).toBe("accepted");

    const stalePush = await request(app)
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        changes: {
          glucoseReadings: [
            {
              clientUuid,
              valueMgDl: 120,
              readingType: "fasting",
              context: "normal",
              source: "manual",
              measuredAt,
              version: 2,
            },
          ],
        },
      });
    expect(stalePush.status).toBe(200);
    expect(stalePush.body.data.results[0].status).toBe("stale");
  });
});
