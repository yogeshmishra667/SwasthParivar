// Integration tests use `any` for `app` / `prisma` / `supertest` bodies
// to match the existing convention in readings.test.ts + bp.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

// Phase 4 Feature E.2 — cardiac integration suite. Mirrors the BP suite
// container/auth setup; the only Phase-4 deltas are
//   (a) `create_hypertable('cardiac_logs', …)` after migrate-deploy,
//   (b) `setFlag('cardiac_logging_enabled', true)` in beforeAll, and
//   (c) a per-category critical-bypass enqueue check.

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
const TEST_PHONE = "+919812345699";

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
  // Hypertable conversion — same convention as BP/glucose. Required so
  // partitioning behaviour matches production.
  runPrisma(["db", "execute", "--stdin"], {
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('cardiac_logs', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  // Default-off kill-switch must be flipped explicitly per test suite —
  // mirrors how phase-4 ops would roll out the feature.
  await flagsModule.setFlag("cardiac_logging_enabled", true, "integration_test");
  flagsModule.__resetFlagCache();

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Cardiac Tester",
      age: 65,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  accessToken = jwt.sign({ sub: user.id, householdId: user.householdId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
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

describe("POST /api/v1/readings/cardiac — happy path", () => {
  it("saves a normal-band reading and echoes the persisted row", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 72,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reading.heartRate).toBe(72);
    expect(res.body.data.reading.clientUuid).toBe(clientUuid);
    expect(res.body.data.critical.isCritical).toBe(false);
    expect(res.body.data.critical.primaryReason).toBe("normal");
  });

  it("returns severity primaryReason for a warn-band reading", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 45, // warn.hr_borderline_low (40–49)
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);
    expect(res.body.data.critical.primaryReason).toBe("warn.hr_borderline_low");
  });
});

describe("POST /api/v1/readings/cardiac — validation", () => {
  it("rejects HR below valid floor with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 20, // below HR_VALID_MIN=30
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects HR above valid ceiling with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 300, // above HR_VALID_MAX=250
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects painSeverity > 0 without chestPain=true", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 72,
        rhythmStatus: "regular",
        chestPain: false,
        painSeverity: 5, // ← inconsistent
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("accepts chestPain=true without explicit severity (defaults to warn band)", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 72,
        rhythmStatus: "regular",
        chestPain: true,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);
    expect(res.body.data.critical.primaryReason).toBe("warn.chest_pain");
  });

  it("rejects payload missing source with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        heartRate: 72,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/readings/cardiac — idempotency", () => {
  it("rejects stale version with READING_STALE_VERSION (409)", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 78,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt,
        version: 2,
      })
      .expect(201);

    const stale = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 78,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt,
        version: 1,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("READING_STALE_VERSION");
  });

  it("replays same {clientUuid, version} idempotently — no duplicate row", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    const payload = {
      clientUuid,
      heartRate: 80,
      rhythmStatus: "regular",
      chestPain: false,
      exerciseTolerance: "normal",
      source: "manual",
      measuredAt,
      version: 1,
    };
    const first = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload);
    const replay = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.reading.id).toBe(first.body.data.reading.id);

    const count = await prisma.cardiacLog.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });

  it("idempotent upsert: higher version updates in place", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 70,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt,
        version: 1,
      })
      .expect(201);

    const edited = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 88,
        rhythmStatus: "irregular",
        chestPain: false,
        exerciseTolerance: "reduced",
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(edited.status).toBe(201);
    expect(edited.body.data.reading.heartRate).toBe(88);
    expect(edited.body.data.reading.rhythmStatus).toBe("irregular");

    const count = await prisma.cardiacLog.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });
});

describe("POST /api/v1/readings/cardiac — critical-bypass enqueue", () => {
  it("HR < 40 enqueues a CRITICAL_ALERT job with cardiac category", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Bypass Cardiac",
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
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 35,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
          version: 1,
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.data.critical.isCritical).toBe(true);
      expect(postRes.body.data.critical.primaryReason).toBe("critical.hr_low");
      expect(postRes.body.data.critical.withinCooldown).toBe(false);

      const readingId = postRes.body.data.reading.id;
      let foundCardiacJob = false;
      for (let attempt = 0; attempt < 20 && !foundCardiacJob; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundCardiacJob = jobs.some(
          (j) => j.data?.category === "cardiac" && j.data?.readingId === readingId,
        );
        if (!foundCardiacJob) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundCardiacJob).toBe(true);
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);

  it("chest pain severity ≥ 7 enqueues with chest_pain copy key (cardiac precedence)", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Chest Pain",
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
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 95,
          rhythmStatus: "regular",
          chestPain: true,
          painSeverity: 9,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.data.critical.isCritical).toBe(true);
      expect(postRes.body.data.critical.primaryReason).toBe("critical.chest_pain_severe");

      const readingId = postRes.body.data.reading.id;
      let foundChestPainJob = false;
      for (let attempt = 0; attempt < 20 && !foundChestPainJob; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundChestPainJob = jobs.some(
          (j) =>
            j.data?.category === "cardiac" &&
            j.data?.readingId === readingId &&
            j.data?.dispatch?.copyKey === "critical.cardiac.chest_pain",
        );
        if (!foundChestPainJob) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundChestPainJob).toBe(true);
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);

  it("second critical reading within 30min stamps withinCooldown=true and skips enqueue", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Cooldown Cardiac",
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
      const first = await request(app)
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 32,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(first.body.data.critical.withinCooldown).toBe(false);

      const second = await request(app)
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 200,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(second.body.data.critical.isCritical).toBe(true);
      expect(second.body.data.critical.withinCooldown).toBe(true);

      // The second reading should NOT enqueue a fresh dispatch.
      const secondReadingId = second.body.data.reading.id;
      await new Promise((r) => setTimeout(r, 300));
      const jobs = await probeQueue.getJobs(["waiting", "active", "delayed", "completed"], 0, 200);
      const secondJob = jobs.find(
        (j) => j.data?.category === "cardiac" && j.data?.readingId === secondReadingId,
      );
      expect(secondJob).toBeUndefined();
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);
});

describe("POST /api/v1/readings/cardiac — kill-switch", () => {
  it("returns 503 CARDIAC_DISABLED when the feature flag is off", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("cardiac_logging_enabled", false, "integration_test");
    flagsModule.__resetFlagCache();
    try {
      const res = await request(app)
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 72,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("CARDIAC_DISABLED");
    } finally {
      await flagsModule.setFlag("cardiac_logging_enabled", true, "integration_test");
      flagsModule.__resetFlagCache();
    }
  });
});

describe("GET /api/v1/readings/cardiac", () => {
  it("returns caller's logs in descending measuredAt order", async () => {
    const res = await request(app)
      .get("/api/v1/readings/cardiac?limit=10")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.data)).toBe(true);
    for (let i = 1; i < res.body.data.data.length; i++) {
      const prev = new Date(res.body.data.data[i - 1].measuredAt).getTime();
      const curr = new Date(res.body.data.data[i].measuredAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("DELETE /api/v1/readings/cardiac/:id", () => {
  it("removes a log owned by the caller", async () => {
    const clientUuid = randomUUID();
    const created = await request(app)
      .post("/api/v1/readings/cardiac")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        heartRate: 70,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    const id = created.body.data.reading.id;

    const del = await request(app)
      .delete(`/api/v1/readings/cardiac/${id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const remaining = await prisma.cardiacLog.findFirst({ where: { id } });
    expect(remaining).toBeNull();
  });

  it("returns 404 READING_NOT_FOUND when the row is not owned by the caller", async () => {
    // Create a row under a different user, then try to delete from the
    // first user's token. The id exists in the DB but does not belong to
    // the caller, so the service returns READING_NOT_FOUND (preferred
    // over 403 to avoid leaking existence).
    const otherHousehold = await prisma.household.create({ data: {} });
    const otherUser = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Other",
        age: 60,
        householdId: otherHousehold.id,
        onboardingComplete: true,
      },
    });
    const row = await prisma.cardiacLog.create({
      data: {
        clientUuid: randomUUID(),
        heartRate: 70,
        rhythmStatus: "regular",
        chestPain: false,
        exerciseTolerance: "normal",
        source: "manual",
        measuredAt: new Date(),
        userId: otherUser.id,
      },
    });

    const del = await request(app)
      .delete(`/api/v1/readings/cardiac/${row.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("READING_NOT_FOUND");

    // The row must still exist in the DB — the failed delete is non-
    // destructive.
    const stillThere = await prisma.cardiacLog.findFirst({ where: { id: row.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe("POST /api/v1/readings/cardiac — unauthorised", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await request(app).post("/api/v1/readings/cardiac").send({
      clientUuid: randomUUID(),
      heartRate: 72,
      rhythmStatus: "regular",
      chestPain: false,
      exerciseTolerance: "normal",
      source: "manual",
      measuredAt: new Date().toISOString(),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/readings/cardiac — ANALYZE_READING enqueue", () => {
  it("every successful write enqueues an ANALYZE_READING job with category=cardiac", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Analyze Cardiac",
        age: 55,
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
    const probeQueue = new Queue(queueModule.QUEUE_NAMES.ANALYZE_READING, { connection: conn });

    try {
      const postRes = await request(app)
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 78,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
          version: 1,
        });
      expect(postRes.status).toBe(201);
      const readingId = postRes.body.data.reading.id;

      let foundJob = false;
      for (let attempt = 0; attempt < 20 && !foundJob; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundJob = jobs.some(
          (j) => j.data?.category === "cardiac" && j.data?.readingId === readingId,
        );
        if (!foundJob) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundJob).toBe(true);
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);
});
