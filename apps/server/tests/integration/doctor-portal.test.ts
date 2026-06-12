// Phase 4 Feature G.2 — /api/v1/doctors + /api/v1/appointments tests.
//
// Covers CRUD on both surfaces + the household authz model + the
// `doctor_portal_enabled` kill-switch + the reschedule reminder-flag
// reset. Single Postgres/Redis container shared across the file; mirrors
// emergency-contacts.test.ts setup.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
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
let setFlag: (key: string, value: boolean, actor: string) => Promise<unknown>;
let resetFlagCache: () => void;

let patientId: string;
let subProfileId: string;
let patientToken: string;
let outsiderToken: string;

const setPortal = async (enabled: boolean): Promise<void> => {
  await setFlag("doctor_portal_enabled", enabled, "integration_test");
  resetFlagCache();
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
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;

  // Default the portal ON for the CRUD tests; the kill-switch case
  // flips it off and back on within its own block.
  await setPortal(true);

  const householdA = await prisma.household.create({ data: {} });
  const householdB = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: "+919812360010",
      name: "Ramesh",
      age: 65,
      householdId: householdA.id,
      onboardingComplete: true,
    },
  });
  // Sub-profile in the SAME household — drives the targetUserId path.
  const subProfile = await prisma.user.create({
    data: {
      phone: "+919812360011",
      name: "Sita",
      age: 62,
      householdId: householdA.id,
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: "+919812360020",
      name: "Stranger",
      age: 40,
      householdId: householdB.id,
      onboardingComplete: true,
    },
  });
  patientId = patient.id;
  subProfileId = subProfile.id;

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

const postDoctor = async (
  token: string,
  body: Record<string, unknown>,
): Promise<request.Response> =>
  await request(app).post("/api/v1/doctors").set("Authorization", `Bearer ${token}`).send(body);

const makeDoctor = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const res = await postDoctor(token, {
    name: "Dr. Mehta",
    specialty: "Endocrinology",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data.doctor.id as string;
};

describe("doctor_portal_enabled kill-switch", () => {
  it("returns 503 DOCTOR_PORTAL_DISABLED when the flag is off", async () => {
    await setPortal(false);
    const res = await postDoctor(patientToken, { name: "Dr. X", specialty: "Cardiology" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DOCTOR_PORTAL_DISABLED");
    await setPortal(true);
  });

  it("still returns 401 (auth) before the flag check when no token is present", async () => {
    await setPortal(false);
    const res = await request(app).get("/api/v1/doctors");
    expect(res.status).toBe(401);
    await setPortal(true);
  });
});

describe("POST/GET/PUT /api/v1/doctors", () => {
  it("creates a doctor for the caller", async () => {
    const res = await postDoctor(patientToken, {
      name: "Dr. Mehta",
      specialty: "Endocrinology",
      clinicName: "Sunrise Clinic",
      phone: "+919812360099",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.doctor).toMatchObject({
      userId: patientId,
      name: "Dr. Mehta",
      specialty: "Endocrinology",
      clinicName: "Sunrise Clinic",
      phone: "+919812360099",
    });
  });

  it("creates a doctor for a same-household sub-profile via targetUserId", async () => {
    const res = await postDoctor(patientToken, {
      name: "Dr. Rao",
      specialty: "Pulmonology",
      targetUserId: subProfileId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.doctor.userId).toBe(subProfileId);
  });

  it("lists only the resolved member's doctors", async () => {
    const list = await request(app)
      .get(`/api/v1/doctors?targetUserId=${subProfileId}`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(list.status).toBe(200);
    const owners: string[] = list.body.data.doctors.map((d: { userId: string }) => d.userId);
    expect(owners.every((o) => o === subProfileId)).toBe(true);
  });

  it("updates a doctor and can clear an optional field with null", async () => {
    const id = await makeDoctor(patientToken, { clinicName: "Old Clinic" });
    const res = await request(app)
      .put(`/api/v1/doctors/${id}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clinicName: null, specialty: "Diabetology" });
    expect(res.status).toBe(200);
    expect(res.body.data.doctor.clinicName).toBeNull();
    expect(res.body.data.doctor.specialty).toBe("Diabetology");
  });

  it("returns 404 DOCTOR_NOT_FOUND for an unknown id", async () => {
    const res = await request(app)
      .put(`/api/v1/doctors/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
  });

  it("blocks a different household from editing a doctor (403)", async () => {
    const id = await makeDoctor(patientToken);
    const res = await request(app)
      .put(`/api/v1/doctors/${id}`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});

describe("POST/GET/PUT /api/v1/appointments", () => {
  const future = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

  it("creates an appointment against an owned doctor", async () => {
    const doctorId = await makeDoctor(patientToken);
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(10), purpose: "Quarterly review" });
    expect(res.status).toBe(201);
    expect(res.body.data.appointment).toMatchObject({
      userId: patientId,
      doctorId,
      purpose: "Quarterly review",
      status: "scheduled",
    });
  });

  it("rejects an appointment whose doctor belongs to another household (403)", async () => {
    const outsiderDoctorId = await makeDoctor(outsiderToken);
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId: outsiderDoctorId, scheduledAt: future(5), purpose: "X" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("rejects an appointment whose doctor belongs to a different patient in the same household (404)", async () => {
    // Doctor owned by the sub-profile; patient books for themselves.
    const subDoctorId = await makeDoctor(patientToken, { targetUserId: subProfileId });
    const res = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId: subDoctorId, scheduledAt: future(5), purpose: "Mismatch" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
  });

  it("lists appointments filtered by status, upcoming-first", async () => {
    const doctorId = await makeDoctor(patientToken);
    await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(20), purpose: "Later" });
    await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(2), purpose: "Sooner" });

    const list = await request(app)
      .get("/api/v1/appointments?status=scheduled")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.data.every((a: { status: string }) => a.status === "scheduled")).toBe(
      true,
    );
    const times = list.body.data.data.map((a: { scheduledAt: string }) => a.scheduledAt);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  it("resets reminder flags when an appointment is rescheduled", async () => {
    const doctorId = await makeDoctor(patientToken);
    const created = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(15), purpose: "Reschedule me" });
    const apptId = created.body.data.appointment.id as string;

    // Simulate the cron having already fired all three windows.
    await prisma.doctorAppointment.update({
      where: { id: apptId },
      data: { reminderSent7d: true, reminderSent1d: true, reminderSent2h: true },
    });

    const res = await request(app)
      .put(`/api/v1/appointments/${apptId}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ scheduledAt: future(30) });
    expect(res.status).toBe(200);

    const row = await prisma.doctorAppointment.findUnique({ where: { id: apptId } });
    expect(row.reminderSent7d).toBe(false);
    expect(row.reminderSent1d).toBe(false);
    expect(row.reminderSent2h).toBe(false);
  });

  it("does NOT reset reminder flags when only the purpose changes", async () => {
    const doctorId = await makeDoctor(patientToken);
    const created = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(15), purpose: "Keep flags" });
    const apptId = created.body.data.appointment.id as string;
    await prisma.doctorAppointment.update({
      where: { id: apptId },
      data: { reminderSent7d: true },
    });
    await request(app)
      .put(`/api/v1/appointments/${apptId}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ purpose: "Edited purpose only" });
    const row = await prisma.doctorAppointment.findUnique({ where: { id: apptId } });
    expect(row.reminderSent7d).toBe(true);
  });

  it("marks an appointment completed via /complete", async () => {
    const doctorId = await makeDoctor(patientToken);
    const created = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(3), purpose: "Done" });
    const apptId = created.body.data.appointment.id as string;
    const res = await request(app)
      .post(`/api/v1/appointments/${apptId}/complete`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.appointment.status).toBe("completed");
  });

  it("returns 404 APPOINTMENT_NOT_FOUND for an unknown id", async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/00000000-0000-0000-0000-000000000000/complete`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("blocks a different household from touching an appointment (403)", async () => {
    const doctorId = await makeDoctor(patientToken);
    const created = await request(app)
      .post("/api/v1/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, scheduledAt: future(4), purpose: "Private" });
    const apptId = created.body.data.appointment.id as string;
    const res = await request(app)
      .put(`/api/v1/appointments/${apptId}`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ status: "cancelled" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});
