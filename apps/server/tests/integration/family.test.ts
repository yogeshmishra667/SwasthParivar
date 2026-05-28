// Phase 2 step 7 — /api/v1/family integration tests.
//
// Covers the full invite → accept → dashboard read flow plus the
// FAILURE branches (no guardian, double-invite, wrong-role privacy
// edit, dashboard before-accept, decline). Uses the same Testcontainers
// + buildApp pattern as meals.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { randomUUID } from "node:crypto";
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

// Three users: a patient, a guardian, and an outsider with no link.
let patientId: string;
let guardianId: string;
let outsiderId: string;
let patientToken: string;
let guardianToken: string;
let outsiderToken: string;

const PATIENT_PHONE = "+919812345710";
const GUARDIAN_PHONE = "+919812345720";
const OUTSIDER_PHONE = "+919812345730";
const ABSENT_PHONE = "+919812345799";

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
  // The dashboard endpoint touches glucose_readings even when none
  // exist; the hypertable conversion still needs to run for inserts in
  // future tests on the same container to work.
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  // Patient + guardian live in *different* households to prove the
  // family link bridges across households (it is not a household-share).
  const patientHousehold = await prisma.household.create({ data: {} });
  const guardianHousehold = await prisma.household.create({ data: {} });
  const outsiderHousehold = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: PATIENT_PHONE,
      name: "Ramesh",
      age: 65,
      householdId: patientHousehold.id,
      conditions: ["diabetes", "hypertension"],
      onboardingComplete: true,
    },
  });
  const guardian = await prisma.user.create({
    data: {
      phone: GUARDIAN_PHONE,
      name: "Suresh",
      age: 35,
      householdId: guardianHousehold.id,
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: OUTSIDER_PHONE,
      name: "Outsider",
      age: 40,
      householdId: outsiderHousehold.id,
      onboardingComplete: true,
    },
  });

  patientId = patient.id;
  guardianId = guardian.id;
  outsiderId = outsider.id;

  // Mirror real signup: each household's primary is the first User
  // created in it. Production sets this inside the signup transaction;
  // tests bypass the auth flow and seed users directly, so set it
  // explicitly here.
  await prisma.household.update({
    where: { id: patientHousehold.id },
    data: { primaryUserId: patient.id },
  });
  await prisma.household.update({
    where: { id: guardianHousehold.id },
    data: { primaryUserId: guardian.id },
  });
  await prisma.household.update({
    where: { id: outsiderHousehold.id },
    data: { primaryUserId: outsider.id },
  });
  patientToken = jwt.sign(
    { sub: patientId, householdId: patientHousehold.id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  guardianToken = jwt.sign(
    { sub: guardianId, householdId: guardianHousehold.id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  outsiderToken = jwt.sign(
    { sub: outsiderId, householdId: outsiderHousehold.id },
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

describe("POST /api/v1/family/invite", () => {
  it("rejects an invite when no user has that phone", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ guardianPhone: ABSENT_PHONE });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FAMILY_INVITE_INVALID");
  });

  it("rejects self-invite", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ guardianPhone: PATIENT_PHONE });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FAMILY_INVITE_INVALID");
  });

  it("rejects a guardian in the same household as the patient", async () => {
    // Same-household FamilyLinks are semantically wrong — that's what
    // the household-scoped notification path is for, not FamilyLink.
    const sibling = await prisma.user.create({
      data: {
        phone: "+919812345799",
        name: "Sibling",
        age: 30,
        // Use the patient's household so the guardian-side phone resolves
        // to a user already inside the patient's household.
        householdId: (
          await prisma.user.findUniqueOrThrow({
            where: { id: patientId },
            select: { householdId: true },
          })
        ).householdId,
        onboardingComplete: true,
      },
    });
    try {
      const res = await request(app)
        .post("/api/v1/family/invite")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ guardianPhone: sibling.phone });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FAMILY_INVITE_INVALID");
    } finally {
      await prisma.user.delete({ where: { id: sibling.id } });
    }
  });

  it("creates a pending invite and echoes the guardian summary", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        guardianPhone: GUARDIAN_PHONE,
        relationship: "son",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.link.status).toBe("pending");
    expect(res.body.data.link.patientId).toBe(patientId);
    expect(res.body.data.link.guardianId).toBe(guardianId);
    expect(res.body.data.guardian.name).toBe("Suresh");
  });

  it("rejects a second invite while the first is still active", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ guardianPhone: GUARDIAN_PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FAMILY_LINK_EXISTS");
  });
});

describe("GET /api/v1/family/invites", () => {
  it("guardian sees the pending invite addressed to them", async () => {
    const res = await request(app)
      .get("/api/v1/family/invites")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invites).toHaveLength(1);
    const invite = res.body.data.invites[0];
    expect(invite.patient.id).toBe(patientId);
    expect(invite.patient.name).toBe("Ramesh");
    expect(invite.relationship).toBe("son");
    expect(invite.linkId).toBeTruthy();
  });

  it("patient sees no invites — they sent it, did not receive one", async () => {
    const res = await request(app)
      .get("/api/v1/family/invites")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invites).toEqual([]);
  });

  it("outsider with no link sees an empty list", async () => {
    const res = await request(app)
      .get("/api/v1/family/invites")
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invites).toEqual([]);
  });
});

describe("dashboard access before accept", () => {
  it("guardian cannot read the patient dashboard while invite is pending", async () => {
    const res = await request(app)
      .get(`/api/v1/family/patients/${patientId}/dashboard`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("outsider gets 403 even with a UUID guess", async () => {
    const res = await request(app)
      .get(`/api/v1/family/patients/${patientId}/dashboard`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/family/invites/:linkId/respond", () => {
  it("guardian accepts the pending invite", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .post(`/api/v1/family/invites/${link.id}/respond`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ decision: "accept" });
    expect(res.status).toBe(200);
    expect(res.body.data.link.status).toBe("accepted");
    expect(res.body.data.link.acceptedAt).toBeTruthy();
  });

  it("cannot accept twice (status no longer pending)", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .post(`/api/v1/family/invites/${link.id}/respond`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ decision: "accept" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FAMILY_INVITE_INVALID");
  });

  it("patient cannot respond — only the guardian can", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .post(`/api/v1/family/invites/${link.id}/respond`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ decision: "accept" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FAMILY_LINK_NOT_FOUND");
  });
});

describe("GET /api/v1/family/patients", () => {
  it("guardian sees the accepted patient with default conditions visible", async () => {
    const res = await request(app)
      .get("/api/v1/family/patients?status=accepted")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patients).toHaveLength(1);
    const row = res.body.data.patients[0];
    expect(row.patient.id).toBe(patientId);
    expect(row.patient.name).toBe("Ramesh");
    expect(row.patient.conditions).toEqual(expect.arrayContaining(["diabetes", "hypertension"]));
    expect(row.relationship).toBe("son");
  });

  it("status filter narrows results — no pending links for this guardian", async () => {
    const res = await request(app)
      .get("/api/v1/family/patients?status=pending")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patients).toEqual([]);
  });
});

describe("GET /api/v1/family/patients/:id/dashboard", () => {
  // The PII-strip assertions below rely on these sentinels appearing in
  // the patient's raw rows but NEVER in the guardian payload.
  const SECRET_NOTE = "private-glucose-note-do-not-leak";
  const SECRET_PHOTO_URL = "https://r2.example.com/medicine-photo-private.png";

  it("returns a PII-stripped read-only dashboard for the guardian", async () => {
    // Seed a glucose reading with `notes` populated, plus a medication
    // with photoUrl + timeSlots + quantityRemaining set — these are the
    // exact fields the strip layer is supposed to drop.
    await prisma.glucoseReading.create({
      data: {
        clientUuid: randomUUID(),
        userId: patientId,
        valueMgDl: 142,
        readingType: "fasting",
        source: "manual",
        notes: SECRET_NOTE,
        measuredAt: new Date(),
        streakCreditedTo: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    await prisma.medicationSchedule.create({
      data: {
        userId: patientId,
        medicineName: "Metformin",
        dosage: "500mg",
        timeSlots: ["08:00", "20:00"],
        photoUrl: SECRET_PHOTO_URL,
        quantityRemaining: 12,
        active: true,
      },
    });

    const res = await request(app)
      .get(`/api/v1/family/patients/${patientId}/dashboard`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.readOnly).toBe(true);
    expect(res.body.data.viewerUserId).toBe(guardianId);
    expect(res.body.data.patient.id).toBe(patientId);
    expect(res.body.data.patient.name).toBe("Ramesh");

    // Step-6 dashboard fields are reused.
    expect(res.body.data.summary).toBeTruthy();
    expect(res.body.data.streak).toBeTruthy();
    expect(res.body.data.mealsToday).toBeInstanceOf(Array);
    expect(typeof res.body.data.insightsUnacknowledgedCount).toBe("number");

    // PII strip: latestReading carries the value but never the note.
    expect(res.body.data.latestReading.valueMgDl).toBe(142);
    expect(res.body.data.latestReading.notes).toBeUndefined();
    expect(res.body.data.todayReadingCount).toBeGreaterThanOrEqual(1);

    // PII strip: medication has name+dosage but no photo / schedule / stock.
    const med = res.body.data.medications.find((m: any) => m.medicineName === "Metformin");
    expect(med).toBeTruthy();
    expect(med.dosage).toBe("500mg");
    expect(med.photoUrl).toBeUndefined();
    expect(med.timeSlots).toBeUndefined();
    expect(med.quantityRemaining).toBeUndefined();

    // PII strip — none of these leak anywhere in the payload.
    const payload = JSON.stringify(res.body.data);
    expect(payload).not.toContain(PATIENT_PHONE);
    expect(payload).not.toContain(SECRET_NOTE);
    expect(payload).not.toContain(SECRET_PHOTO_URL);
  });
});

describe("PUT /api/v1/family/links/:linkId/privacy", () => {
  it("patient hides hypertension by setting visibleConditions=[diabetes]", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .put(`/api/v1/family/links/${link.id}/privacy`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ visibleConditions: ["diabetes"] });
    expect(res.status).toBe(200);
    expect(res.body.data.link.visibleConditions).toEqual(["diabetes"]);

    // Dashboard should now filter hypertension out.
    const dash = await request(app)
      .get(`/api/v1/family/patients/${patientId}/dashboard`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(dash.body.data.patient.conditions).toEqual(["diabetes"]);
  });

  it("guardian cannot edit visibility (only revoke)", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .put(`/api/v1/family/links/${link.id}/privacy`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ visibleConditions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("either side can revoke; revoked link blocks dashboard reads", async () => {
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .put(`/api/v1/family/links/${link.id}/privacy`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ revoke: true });
    expect(res.status).toBe(200);
    expect(res.body.data.link.status).toBe("revoked");

    const dash = await request(app)
      .get(`/api/v1/family/patients/${patientId}/dashboard`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(dash.status).toBe(403);
  });

  it("after revoke, patient can re-invite the same guardian", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ guardianPhone: GUARDIAN_PHONE, relationship: "son" });
    expect(res.status).toBe(201);
    expect(res.body.data.link.status).toBe("pending");
  });
});

describe("decline flow", () => {
  it("guardian declines a fresh invite", async () => {
    // The pending invite from the previous test exists; decline it.
    const link = await prisma.familyLink.findUnique({
      where: { patientId_guardianId: { patientId, guardianId } },
    });
    const res = await request(app)
      .post(`/api/v1/family/invites/${link.id}/respond`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ decision: "decline" });
    expect(res.status).toBe(200);
    expect(res.body.data.link.status).toBe("declined");
  });
});

// Shared-phone households: a non-primary profile (e.g. Maa) has no
// login of its own — the primary's JWT acts for it. An invite must
// still be linkable TO that profile via `targetUserId`, and the
// primary must be able to manage that link on the profile's behalf.
describe("profile-aware invites (shared-phone household)", () => {
  const SECOND_GUARDIAN_PHONE = "+919812345740";
  let maaId: string;
  let secondGuardianId: string;
  let maaLinkId: string;

  beforeAll(async () => {
    // Maa is a non-primary profile inside the PRIMARY patient's
    // household — created the way the household profile switcher does
    // (synthetic phone, no independent login).
    const patient = await prisma.user.findUnique({
      where: { id: patientId },
      select: { householdId: true },
    });
    const maa = await prisma.user.create({
      data: {
        phone: `household:${patientId}:maa`,
        name: "Maa",
        age: 62,
        householdId: patient.householdId,
        conditions: ["diabetes"],
        onboardingComplete: true,
      },
    });
    maaId = maa.id;

    // A fresh guardian in their own household.
    const guardianHousehold = await prisma.household.create({ data: {} });
    const guardian = await prisma.user.create({
      data: {
        phone: SECOND_GUARDIAN_PHONE,
        name: "Anjali",
        age: 33,
        householdId: guardianHousehold.id,
        onboardingComplete: true,
      },
    });
    secondGuardianId = guardian.id;
    await prisma.household.update({
      where: { id: guardianHousehold.id },
      data: { primaryUserId: guardian.id },
    });
  });

  it("links the invite to the non-primary profile named by targetUserId", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        guardianPhone: SECOND_GUARDIAN_PHONE,
        targetUserId: maaId,
        relationship: "daughter",
      });
    expect(res.status).toBe(201);
    // The patient side is Maa — NOT the primary caller who holds the JWT.
    expect(res.body.data.link.patientId).toBe(maaId);
    expect(res.body.data.link.guardianId).toBe(secondGuardianId);
    maaLinkId = res.body.data.link.id;
  });

  it("rejects a targetUserId outside the caller's household", async () => {
    const res = await request(app)
      .post("/api/v1/family/invite")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ guardianPhone: SECOND_GUARDIAN_PHONE, targetUserId: outsiderId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("lets the household primary revoke a non-primary profile's link", async () => {
    // The JWT subject (primary) is neither the link's patient nor its
    // guardian — authorisation flows through shared household identity.
    const res = await request(app)
      .put(`/api/v1/family/links/${maaLinkId}/privacy`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ revoke: true });
    expect(res.status).toBe(200);
    expect(res.body.data.link.status).toBe("revoked");
  });
});
