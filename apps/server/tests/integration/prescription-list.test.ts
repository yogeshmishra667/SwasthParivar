// Phase 4 §G dashboard surface — GET /api/v1/prescriptions list tests.
//
// The list endpoint backs the dashboard "pending approval" nudge. Rows
// are inserted directly via Prisma (the full upload→OCR flow is covered
// by prescriptions.test.ts) so we can assert filtering, ordering,
// pending-item counts, and household authz in isolation.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";

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

let patientId: string;
let patientToken: string;
let outsiderToken: string;

const makePrescription = async (
  status: string,
  items: { status: string }[] = [],
): Promise<string> => {
  const row = await prisma.prescription.create({
    data: { userId: patientId, requiresGuardianApproval: true, originalPhotoUrls: [], status },
  });
  for (const it of items) {
    await prisma.prescriptionItem.create({
      data: {
        prescriptionId: row.id,
        ocrMedicineName: "Metformin",
        ocrDosage: "500mg",
        ocrFrequency: "1x",
        ocrConfidence: 0.9,
        ocrColor: "green",
        status: it.status,
      },
    });
  }
  return row.id as string;
};

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

  const householdA = await prisma.household.create({ data: {} });
  const householdB = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: "+919812390010",
      name: "Ramesh",
      age: 67,
      householdId: householdA.id,
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: "+919812390020",
      name: "Stranger",
      age: 40,
      householdId: householdB.id,
      onboardingComplete: true,
    },
  });
  patientId = patient.id;
  patientToken = jwt.sign(
    { sub: patient.id, householdId: patient.householdId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  outsiderToken = jwt.sign(
    { sub: outsider.id, householdId: outsider.householdId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
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
  await prisma.prescriptionItem.deleteMany({});
  await prisma.prescription.deleteMany({ where: { userId: patientId } });
});

describe("GET /api/v1/prescriptions", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/prescriptions");
    expect(res.status).toBe(401);
  });

  it("lists the caller's prescriptions newest-first", async () => {
    await makePrescription("approved");
    await new Promise((r) => setTimeout(r, 10));
    const newest = await makePrescription("pending_approval");
    const res = await request(app)
      .get("/api/v1/prescriptions")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.prescriptions).toHaveLength(2);
    expect(res.body.data.prescriptions[0].id).toBe(newest);
  });

  it("filters by status", async () => {
    await makePrescription("approved");
    await makePrescription("pending_approval");
    await makePrescription("pending_approval");
    const res = await request(app)
      .get("/api/v1/prescriptions?status=pending_approval")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.prescriptions).toHaveLength(2);
    expect(
      res.body.data.prescriptions.every((p: { status: string }) => p.status === "pending_approval"),
    ).toBe(true);
  });

  it("counts pending + need_clarification items as pendingItemCount", async () => {
    await makePrescription("pending_approval", [
      { status: "pending" },
      { status: "need_clarification" },
      { status: "approved" },
    ]);
    const res = await request(app)
      .get("/api/v1/prescriptions?status=pending_approval")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.body.data.prescriptions[0].pendingItemCount).toBe(2);
  });

  it("rejects a malformed status (zod)", async () => {
    const res = await request(app)
      .get("/api/v1/prescriptions?status=bogus")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("blocks a different household from listing via targetUserId (403)", async () => {
    await makePrescription("pending_approval");
    const res = await request(app)
      .get(`/api/v1/prescriptions?targetUserId=${patientId}`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});
