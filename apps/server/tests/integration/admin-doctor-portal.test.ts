// Phase 4 §G admin surface — ops appoint write-path + read-only
// registry panels for the doctor portal.
//
// Covers: RBAC (analyst forbidden, ops allowed), doctor + appointment
// creation for a patient, the cross-patient doctor guard, audit-row
// writes, and the new read-only registry panels (doctor_appointments).

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import request from "supertest";
import jwt from "jsonwebtoken";
import { spawnSync } from "node:child_process";

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
let opsToken: string;
let analystToken: string;
let patientId: string;

const adminToken = (sub: string): string =>
  jwt.sign({ sub, type: "admin_access" }, process.env.ADMIN_JWT_SECRET!, {
    expiresIn: "1h",
  });

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
  process.env.ADMIN_JWT_SECRET = "test-admin-secret-test-admin-secret-123";
  process.env.ADMIN_JWT_REFRESH_SECRET = "test-admin-refresh-secret-test-123";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const ops = await prisma.adminUser.create({
    data: {
      email: "ops@example.com",
      passwordHash: "dummy",
      name: "Ops",
      role: "ops",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  opsToken = adminToken(ops.id);

  const analyst = await prisma.adminUser.create({
    data: {
      email: "analyst@example.com",
      passwordHash: "dummy",
      name: "Analyst",
      role: "analyst",
      active: true,
      totpEnabled: true,
      totpSecret: "dummy",
    },
  });
  analystToken = adminToken(analyst.id);

  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: "+919812400010",
      name: "Ramesh",
      age: 67,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  patientId = patient.id;
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
  await prisma.doctorAppointment.deleteMany({ where: { userId: patientId } });
  await prisma.doctorProfile.deleteMany({ where: { userId: patientId } });
  await prisma.adminAuditLog.deleteMany({});
});

const createDoctor = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/admin/users/${patientId}/doctors`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("ops appoint — doctors", () => {
  it("creates a doctor for the patient and writes an audit row", async () => {
    const res = await createDoctor(opsToken, {
      name: "Dr. Mehta",
      specialty: "Endocrinology",
      reason: "patient phoned support to book",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: patientId, name: "Dr. Mehta" });

    const audit = await prisma.adminAuditLog.findMany({
      where: { action: "user.doctor_created" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].targetId).toBe(patientId);
  });

  it("rejects the analyst role (403)", async () => {
    const res = await createDoctor(analystToken, {
      name: "Dr. X",
      specialty: "Cardiology",
      reason: "should not work",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("requires a reason (zod)", async () => {
    const res = await createDoctor(opsToken, { name: "Dr. Y", specialty: "GP" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("404s for an unknown patient", async () => {
    const res = await request(app)
      .post(`/admin/users/00000000-0000-0000-0000-000000000000/doctors`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ name: "Dr. Z", specialty: "GP", reason: "unknown patient test" });
    expect(res.status).toBe(404);
  });
});

describe("ops appoint — appointments", () => {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();

  it("books an appointment against an owned doctor + audits it", async () => {
    const doctor = await createDoctor(opsToken, {
      name: "Dr. Mehta",
      specialty: "Endo",
      reason: "setup",
    });
    const doctorId = doctor.body.data.id as string;

    const res = await request(app)
      .post(`/admin/users/${patientId}/appointments`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({
        doctorId,
        scheduledAt: future,
        purpose: "Quarterly review",
        reason: "phone booking",
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: patientId, doctorId, status: "scheduled" });

    const audit = await prisma.adminAuditLog.findMany({
      where: { action: "user.appointment_created" },
    });
    expect(audit).toHaveLength(1);
  });

  it("rejects a doctor that belongs to another patient (404)", async () => {
    const otherHousehold = await prisma.household.create({ data: {} });
    const other = await prisma.user.create({
      data: {
        phone: "+919812400099",
        name: "Other",
        age: 50,
        householdId: otherHousehold.id,
        onboardingComplete: true,
      },
    });
    const otherDoctor = await prisma.doctorProfile.create({
      data: { userId: other.id, name: "Dr. Other", specialty: "GP" },
    });

    const res = await request(app)
      .post(`/admin/users/${patientId}/appointments`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({
        doctorId: otherDoctor.id,
        scheduledAt: future,
        purpose: "X",
        reason: "mismatch",
      });
    expect(res.status).toBe(404);
  });
});

describe("read-only registry panel", () => {
  it("exposes doctor_appointments in the patient 360°", async () => {
    const doctor = await createDoctor(opsToken, {
      name: "Dr. Mehta",
      specialty: "Endo",
      reason: "setup",
    });
    await request(app)
      .post(`/admin/users/${patientId}/appointments`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({
        doctorId: doctor.body.data.id,
        scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        purpose: "Review",
        reason: "booking",
      });

    const res = await request(app)
      .get(`/admin/users/${patientId}/resources/doctor_appointments`)
      .set("Authorization", `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.rows[0].purpose).toBe("Review");
  });
});
