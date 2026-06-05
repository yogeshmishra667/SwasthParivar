// Integration tests use `any` for `app` / `prisma` / `supertest` bodies
// to match the existing convention in readings.test.ts + bp.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

// Phase 4 Feature E.2 — respiratory integration suite. Mirrors the
// cardiac suite shape: same container layout, same hypertable convert,
// same flag flip in beforeAll, same per-category critical-bypass probe.

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
const TEST_PHONE = "+919812345698";

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
    input:
      "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('respiratory_logs', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  await flagsModule.setFlag("respiratory_logging_enabled", true, "integration_test");
  flagsModule.__resetFlagCache();

  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: TEST_PHONE,
      name: "Respiratory Tester",
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

describe("POST /api/v1/readings/respiratory — happy path", () => {
  it("saves a peak-flow reading and echoes the persisted row", async () => {
    const clientUuid = randomUUID();
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 480,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reading.peakFlow).toBe(480);
    expect(res.body.data.reading.baselinePeakFlow).toBe(500);
    expect(res.body.data.reading.clientUuid).toBe(clientUuid);
    expect(res.body.data.critical.isCritical).toBe(false);
    expect(res.body.data.critical.primaryReason).toBe("normal");
  });

  it("accepts inhaler-only log with no peak-flow reading", async () => {
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        inhalerUsed: true,
        inhalerType: "Asthalin",
        puffs: 2,
        symptomSeverity: "mild",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);
    expect(res.body.data.critical.primaryReason).toBe("warn.symptom_mild");
  });
});

describe("POST /api/v1/readings/respiratory — validation", () => {
  it("rejects a payload with no signal (no peakFlow, no inhaler, no symptom)", async () => {
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects peakFlow below valid floor with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        peakFlow: 10, // below PEAK_FLOW_VALID_MIN=50
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects puffs > 0 without inhalerUsed=true", async () => {
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        peakFlow: 480,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        puffs: 2,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects payload missing source with 400", async () => {
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        peakFlow: 480,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/readings/respiratory — idempotency", () => {
  it("rejects stale version with READING_STALE_VERSION (409)", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 470,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt,
        version: 2,
      })
      .expect(201);

    const stale = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 470,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
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
      peakFlow: 460,
      baselinePeakFlow: 500,
      inhalerUsed: false,
      symptomSeverity: "none",
      source: "manual",
      measuredAt,
      version: 1,
    };
    const first = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload);
    const replay = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.reading.id).toBe(first.body.data.reading.id);

    const count = await prisma.respiratoryLog.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });

  it("idempotent upsert: higher version updates in place", async () => {
    const clientUuid = randomUUID();
    const measuredAt = new Date().toISOString();
    await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 460,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt,
        version: 1,
      })
      .expect(201);

    const edited = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 420,
        baselinePeakFlow: 500,
        inhalerUsed: true,
        inhalerType: "Asthalin",
        puffs: 1,
        symptomSeverity: "mild",
        source: "manual",
        measuredAt,
        version: 2,
      });
    expect(edited.status).toBe(201);
    expect(edited.body.data.reading.peakFlow).toBe(420);
    expect(edited.body.data.reading.inhalerUsed).toBe(true);

    const count = await prisma.respiratoryLog.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });
});

describe("POST /api/v1/readings/respiratory — critical-bypass enqueue", () => {
  it("peakFlow < 50% of baseline (red zone) enqueues a CRITICAL_ALERT with respiratory category", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Bypass Respiratory",
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
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          peakFlow: 200, // 200/500 = 40% → red zone
          baselinePeakFlow: 500,
          inhalerUsed: true,
          symptomSeverity: "moderate",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.data.critical.isCritical).toBe(true);
      expect(postRes.body.data.critical.primaryReason).toBe("critical.peak_flow_red_zone");

      const readingId = postRes.body.data.reading.id;
      let foundJob = false;
      for (let attempt = 0; attempt < 20 && !foundJob; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundJob = jobs.some(
          (j) =>
            j.data?.category === "respiratory" &&
            j.data?.readingId === readingId &&
            j.data?.dispatch?.copyKey === "critical.respiratory.peak_flow",
        );
        if (!foundJob) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundJob).toBe(true);
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);

  it("severe symptom (no peakFlow) enqueues with severe_symptom copy key", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Severe Asthma",
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
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          inhalerUsed: true,
          symptomSeverity: "severe",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.data.critical.isCritical).toBe(true);

      const readingId = postRes.body.data.reading.id;
      let foundJob = false;
      for (let attempt = 0; attempt < 20 && !foundJob; attempt++) {
        const jobs = await probeQueue.getJobs(
          ["waiting", "active", "delayed", "completed"],
          0,
          100,
        );
        foundJob = jobs.some(
          (j) =>
            j.data?.category === "respiratory" &&
            j.data?.readingId === readingId &&
            j.data?.dispatch?.copyKey === "critical.respiratory.severe_symptom",
        );
        if (!foundJob) await new Promise((r) => setTimeout(r, 100));
      }
      expect(foundJob).toBe(true);
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
        name: "Cooldown Respiratory",
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
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          peakFlow: 150,
          baselinePeakFlow: 500,
          inhalerUsed: true,
          symptomSeverity: "severe",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(first.body.data.critical.withinCooldown).toBe(false);

      const second = await request(app)
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          peakFlow: 200,
          baselinePeakFlow: 500,
          inhalerUsed: true,
          symptomSeverity: "moderate",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(second.body.data.critical.isCritical).toBe(true);
      expect(second.body.data.critical.withinCooldown).toBe(true);

      const secondReadingId = second.body.data.reading.id;
      await new Promise((r) => setTimeout(r, 300));
      const jobs = await probeQueue.getJobs(["waiting", "active", "delayed", "completed"], 0, 200);
      const secondJob = jobs.find(
        (j) => j.data?.category === "respiratory" && j.data?.readingId === secondReadingId,
      );
      expect(secondJob).toBeUndefined();
    } finally {
      await probeQueue.close();
      await conn.quit();
    }
  }, 30_000);

  it("missing baseline → red-zone branch skipped, falls back to symptom signal", async () => {
    // Per the respiratory classifier defensive path: peakFlow without
    // a baseline does NOT trigger the red zone. Severity stays normal/
    // warn driven by symptom + inhaler signal.
    const res = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid: randomUUID(),
        peakFlow: 100, // would be red zone if baseline were 500
        // baselinePeakFlow omitted on purpose
        inhalerUsed: true,
        symptomSeverity: "mild",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);
    // Warn band — symptom + inhaler — but never critical.
    expect(["warn.symptom_mild", "warn.inhaler_used"]).toContain(
      res.body.data.critical.primaryReason,
    );
  });
});

describe("POST /api/v1/readings/respiratory — kill-switch", () => {
  it("returns 503 RESPIRATORY_DISABLED when the feature flag is off", async () => {
    const flagsModule = await import("../../src/shared/flags/index.js");
    await flagsModule.setFlag("respiratory_logging_enabled", false, "integration_test");
    flagsModule.__resetFlagCache();
    try {
      const res = await request(app)
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          clientUuid: randomUUID(),
          peakFlow: 480,
          baselinePeakFlow: 500,
          inhalerUsed: false,
          symptomSeverity: "none",
          source: "manual",
          measuredAt: new Date().toISOString(),
        });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("RESPIRATORY_DISABLED");
    } finally {
      await flagsModule.setFlag("respiratory_logging_enabled", true, "integration_test");
      flagsModule.__resetFlagCache();
    }
  });
});

describe("GET /api/v1/readings/respiratory", () => {
  it("returns caller's logs in descending measuredAt order", async () => {
    const res = await request(app)
      .get("/api/v1/readings/respiratory?limit=10")
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

describe("DELETE /api/v1/readings/respiratory/:id", () => {
  it("removes a log owned by the caller", async () => {
    const clientUuid = randomUUID();
    const created = await request(app)
      .post("/api/v1/readings/respiratory")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        clientUuid,
        peakFlow: 460,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date().toISOString(),
      });
    const id = created.body.data.reading.id;

    const del = await request(app)
      .delete(`/api/v1/readings/respiratory/${id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const remaining = await prisma.respiratoryLog.findFirst({ where: { id } });
    expect(remaining).toBeNull();
  });

  it("returns 404 READING_NOT_FOUND when the row is not owned by the caller", async () => {
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
    const row = await prisma.respiratoryLog.create({
      data: {
        clientUuid: randomUUID(),
        peakFlow: 460,
        baselinePeakFlow: 500,
        inhalerUsed: false,
        symptomSeverity: "none",
        source: "manual",
        measuredAt: new Date(),
        userId: otherUser.id,
      },
    });

    const del = await request(app)
      .delete(`/api/v1/readings/respiratory/${row.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("READING_NOT_FOUND");

    const stillThere = await prisma.respiratoryLog.findFirst({ where: { id: row.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe("POST /api/v1/readings/respiratory — unauthorised", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await request(app).post("/api/v1/readings/respiratory").send({
      clientUuid: randomUUID(),
      peakFlow: 480,
      baselinePeakFlow: 500,
      inhalerUsed: false,
      symptomSeverity: "none",
      source: "manual",
      measuredAt: new Date().toISOString(),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/readings/respiratory — ANALYZE_READING enqueue", () => {
  it("every successful write enqueues an ANALYZE_READING job with category=respiratory", async () => {
    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Analyze Respiratory",
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
        .post("/api/v1/readings/respiratory")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          peakFlow: 480,
          baselinePeakFlow: 500,
          inhalerUsed: false,
          symptomSeverity: "none",
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
          (j) => j.data?.category === "respiratory" && j.data?.readingId === readingId,
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
