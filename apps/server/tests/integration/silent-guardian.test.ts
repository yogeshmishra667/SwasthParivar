// Phase 3 Feature C — /api/v1/guardian integration tests (C-2 slice).
//
// Covers the four read/write endpoints over GuardianAlert rows:
//   GET  /alerts                    list + patient/type filter + paging
//   POST /alerts/:id/read           mark read (idempotent)
//   POST /alerts/:id/feedback       helpful + action taken
//   GET  /daily-summary/:patientId  yellow-only, last-24h window
// plus the authorisation branches (cross-guardian isolation,
// FAMILY_NO_ACCESS without an accepted link, GUARDIAN_ALERT_NOT_FOUND).
//
// Signal compute + alert dispatch are later slices — every alert here
// is seeded directly. Same Testcontainers + buildApp pattern as
// family.test.ts.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  makeGuardianAlert,
  makeYellowGuardianAlert,
  type GuardianAlertFactoryShape,
} from "@swasth/test-factories";

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
let app: any;
let prisma: any;

let patientId: string;
let guardianId: string;
let guardian2Id: string;
let guardianToken: string;
let guardian2Token: string;

const HOUR = 3_600_000;
const NOW = Date.now();

// Alert ids seeded for the (patient, guardian) pair.
let orangeMedId: string;
let orangeTrendId: string;
let recentYellowId: string;
let staleYellowId: string;
// An alert that belongs to guardian2 — guardian must never see it.
let foreignAlertId: string;

const seedAlert = (o: Partial<GuardianAlertFactoryShape>): Promise<{ id: string }> =>
  prisma.guardianAlert.create({ data: makeGuardianAlert(o) });

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

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  const household = await prisma.household.create({ data: {} });
  const guardianHousehold = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: "+919812300010",
      name: "Ramesh",
      age: 66,
      householdId: household.id,
      conditions: ["diabetes"],
      onboardingComplete: true,
    },
  });
  const guardian = await prisma.user.create({
    data: {
      phone: "+919812300020",
      name: "Suresh",
      age: 34,
      householdId: guardianHousehold.id,
      onboardingComplete: true,
    },
  });
  const guardian2 = await prisma.user.create({
    data: {
      phone: "+919812300030",
      name: "Anil",
      age: 38,
      householdId: guardianHousehold.id,
      onboardingComplete: true,
    },
  });

  patientId = patient.id;
  guardianId = guardian.id;
  guardian2Id = guardian2.id;

  const sign = (id: string, hh: string): string =>
    jwt.sign({ sub: id, householdId: hh }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  guardianToken = sign(guardianId, guardianHousehold.id);
  guardian2Token = sign(guardian2Id, guardianHousehold.id);

  // Only guardian (Suresh) has an accepted link to the patient.
  // guardian2 (Anil) is intentionally unlinked.
  await prisma.familyLink.create({
    data: {
      patientId,
      guardianId,
      status: "accepted",
      acceptedAt: new Date(),
    },
  });

  // Seed the (patient, guardian) alert set — mixed severity + type +
  // age so the list, filter, paging and daily-summary tests all have
  // deterministic data.
  const a1 = await seedAlert({
    patientId,
    guardianId,
    severity: "orange",
    alertType: "med_adherence",
    createdAt: new Date(NOW - 1 * HOUR),
  });
  const a2 = await seedAlert({
    patientId,
    guardianId,
    severity: "orange",
    alertType: "trend_concern",
    createdAt: new Date(NOW - 2 * HOUR),
  });
  const a3 = await prisma.guardianAlert.create({
    data: makeYellowGuardianAlert({
      patientId,
      guardianId,
      alertType: "trend_concern",
      createdAt: new Date(NOW - 3 * HOUR),
    }),
  });
  const a4 = await prisma.guardianAlert.create({
    data: makeYellowGuardianAlert({
      patientId,
      guardianId,
      alertType: "combined",
      createdAt: new Date(NOW - 30 * HOUR), // older than the 24h summary window
    }),
  });
  // Fifth alert (orange / combined) — seeded so the list has 5 rows;
  // its id is not asserted directly.
  await seedAlert({
    patientId,
    guardianId,
    severity: "orange",
    alertType: "combined",
    createdAt: new Date(NOW - 4 * HOUR),
  });
  orangeMedId = a1.id;
  orangeTrendId = a2.id;
  recentYellowId = a3.id;
  staleYellowId = a4.id;

  // One alert for guardian2 → proves cross-guardian isolation.
  const foreign = await seedAlert({
    patientId,
    guardianId: guardian2Id,
    severity: "orange",
    alertType: "med_adherence",
    createdAt: new Date(NOW - 1 * HOUR),
  });
  foreignAlertId = foreign.id;
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

describe("GET /api/v1/guardian/alerts", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/guardian/alerts");
    expect(res.status).toBe(401);
  });

  it("returns only the calling guardian's alerts, newest first", async () => {
    const res = await request(app)
      .get("/api/v1/guardian/alerts")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.data.data.map((a: { id: string }) => a.id);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain(foreignAlertId);
    // createdAt desc → orangeMed (-1h) before orangeTrend (-2h).
    expect(ids.indexOf(orangeMedId)).toBeLessThan(ids.indexOf(orangeTrendId));
  });

  it("guardian2 sees only their own single alert", async () => {
    const res = await request(app)
      .get("/api/v1/guardian/alerts")
      .set("Authorization", `Bearer ${guardian2Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].id).toBe(foreignAlertId);
  });

  it("filters by alert type", async () => {
    const res = await request(app)
      .get("/api/v1/guardian/alerts?type=trend_concern")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    const ids: string[] = res.body.data.data.map((a: { id: string }) => a.id);
    expect(ids.sort()).toEqual([orangeTrendId, recentYellowId].sort());
  });

  it("scopes to one patient when given an accepted-link patientId", async () => {
    const res = await request(app)
      .get(`/api/v1/guardian/alerts?patientId=${patientId}`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(5);
  });

  it("returns FAMILY_NO_ACCESS when the guardian has no accepted link to that patient", async () => {
    const res = await request(app)
      .get(`/api/v1/guardian/alerts?patientId=${patientId}`)
      .set("Authorization", `Bearer ${guardian2Token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });

  it("paginates with a stable cursor", async () => {
    const page1 = await request(app)
      .get("/api/v1/guardian/alerts?limit=2")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.data).toHaveLength(2);
    expect(page1.body.data.hasMore).toBe(true);
    expect(page1.body.data.cursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/api/v1/guardian/alerts?limit=2&cursor=${page1.body.data.cursor}`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(page2.status).toBe(200);
    expect(page2.body.data.data).toHaveLength(2);

    const page1Ids = page1.body.data.data.map((a: { id: string }) => a.id);
    const page2Ids = page2.body.data.data.map((a: { id: string }) => a.id);
    // No overlap between consecutive pages.
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
  });
});

describe("POST /api/v1/guardian/alerts/:alertId/read", () => {
  it("marks an alert read and is idempotent on re-read", async () => {
    const seeded = await seedAlert({ patientId, guardianId, createdAt: new Date(NOW - 5 * HOUR) });

    const first = await request(app)
      .post(`/api/v1/guardian/alerts/${seeded.id}/read`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.alert.readAt).toBeTruthy();
    const firstReadAt = first.body.data.alert.readAt;

    const second = await request(app)
      .post(`/api/v1/guardian/alerts/${seeded.id}/read`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(second.status).toBe(200);
    // First read wins — re-reading never moves the timestamp.
    expect(second.body.data.alert.readAt).toBe(firstReadAt);
  });

  it("returns GUARDIAN_ALERT_NOT_FOUND for another guardian's alert", async () => {
    const res = await request(app)
      .post(`/api/v1/guardian/alerts/${orangeMedId}/read`)
      .set("Authorization", `Bearer ${guardian2Token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GUARDIAN_ALERT_NOT_FOUND");
  });

  it("rejects a malformed alert id", async () => {
    const res = await request(app)
      .post("/api/v1/guardian/alerts/not-a-uuid/read")
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/guardian/alerts/:alertId/feedback", () => {
  it("records actionTaken from an explicit value", async () => {
    const seeded = await seedAlert({ patientId, guardianId, createdAt: new Date(NOW - 6 * HOUR) });
    const res = await request(app)
      .post(`/api/v1/guardian/alerts/${seeded.id}/feedback`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ helpful: true, actionTaken: "called_patient" });
    expect(res.status).toBe(200);
    expect(res.body.data.alert.actionTaken).toBe("called_patient");
  });

  it("derives actionTaken from `helpful` when no action is given", async () => {
    const helpfulAlert = await seedAlert({
      patientId,
      guardianId,
      createdAt: new Date(NOW - 7 * HOUR),
    });
    const helpfulRes = await request(app)
      .post(`/api/v1/guardian/alerts/${helpfulAlert.id}/feedback`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ helpful: true });
    expect(helpfulRes.body.data.alert.actionTaken).toBe("helpful");

    const notHelpfulAlert = await seedAlert({
      patientId,
      guardianId,
      createdAt: new Date(NOW - 8 * HOUR),
    });
    const notHelpfulRes = await request(app)
      .post(`/api/v1/guardian/alerts/${notHelpfulAlert.id}/feedback`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({ helpful: false });
    expect(notHelpfulRes.body.data.alert.actionTaken).toBe("ignored");
  });

  it("rejects feedback missing the required `helpful` field", async () => {
    const res = await request(app)
      .post(`/api/v1/guardian/alerts/${orangeMedId}/feedback`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/guardian/daily-summary/:patientId", () => {
  it("returns only yellow alerts from the last 24h", async () => {
    const res = await request(app)
      .get(`/api/v1/guardian/daily-summary/${patientId}`)
      .set("Authorization", `Bearer ${guardianToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patient.name).toBe("Ramesh");
    const ids: string[] = res.body.data.yellowAlerts.map((a: { id: string }) => a.id);
    // Recent yellow is in; the 30h-old yellow and all orange alerts are out.
    expect(ids).toContain(recentYellowId);
    expect(ids).not.toContain(staleYellowId);
    expect(ids).not.toContain(orangeMedId);
  });

  it("returns FAMILY_NO_ACCESS without an accepted link", async () => {
    const res = await request(app)
      .get(`/api/v1/guardian/daily-summary/${patientId}`)
      .set("Authorization", `Bearer ${guardian2Token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});
