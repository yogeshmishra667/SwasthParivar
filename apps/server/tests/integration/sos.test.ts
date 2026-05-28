// Phase 4 Feature D' — SOS scaffold integration tests.
//
// Covers:
//   - Kill-switch: sos_enabled=false → 503 SOS_DISABLED
//   - Trigger creates the row, snapshots testMode=true (flag default)
//   - Idempotent retry with same clientUuid returns the same row
//   - Cancel + resolve flow + cross-user 403
//   - Active-event lookup
//   - Trigger source guard rejects non-patient_manual values
//
// Worker tick scheduling is exercised by the processor's pure call
// path; we don't spin the actual BullMQ listener in this test (the
// Redis container is enough for the queue add to land). The state-
// machine transitions themselves are covered exhaustively in the
// pure tests under packages/domain-logic/src/sos-escalation/.

import { describe, it, beforeAll, beforeEach, afterAll, expect } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
// FlagValue is a sum type; widening to `unknown` here keeps the test
// harness loose without dragging the full type import into a fixture.
// The flagModule.setFlag has the precise signature.
let setFlag: (key: string, value: unknown, by: string) => Promise<unknown>;
let resetFlagCache: (() => void) | undefined;

// Patient + secondary user fixtures. `patientHouseholdId` and
// `otherUserId` are kept around for future Phase 4 §D'.2 tests
// (multi-patient guardian routing) but aren't read in the current
// scaffold suite.
let patientId: string;
let patientToken: string;
let otherToken: string;

const PATIENT_PHONE = "+919876543210";
const OTHER_PHONE = "+919876543299";

const sign = (sub: string, householdId: string): string =>
  jwt.sign({ sub, householdId }, process.env.JWT_SECRET!, { expiresIn: "1h" });

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
  const flagModule = await import("../../src/shared/flags/flags.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  setFlag = flagModule.setFlag as (key: string, value: unknown, by: string) => Promise<unknown>;
  resetFlagCache = (flagModule as { __resetFlagCache?: () => void }).__resetFlagCache;

  const patientHousehold = await prisma.household.create({ data: {} });
  const otherHousehold = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: PATIENT_PHONE,
      name: "Ramesh ji",
      age: 65,
      householdId: patientHousehold.id,
      conditions: ["diabetes"],
      onboardingComplete: true,
    },
  });
  const other = await prisma.user.create({
    data: {
      phone: OTHER_PHONE,
      name: "Other Patient",
      age: 40,
      householdId: otherHousehold.id,
      onboardingComplete: true,
    },
  });

  // Two guardian contacts for the dispatcher to walk.
  await prisma.emergencyContact.create({
    data: {
      userId: patient.id,
      name: "Beta",
      phone: "+919800000001",
      relationship: "son",
      priority: 1,
      isGuardian: true,
    },
  });
  await prisma.emergencyContact.create({
    data: {
      userId: patient.id,
      name: "Beti",
      phone: "+919800000002",
      relationship: "daughter",
      priority: 2,
      isGuardian: true,
    },
  });

  patientId = patient.id;
  patientToken = sign(patient.id, patientHousehold.id);
  otherToken = sign(other.id, otherHousehold.id);
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
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
});

beforeEach(async () => {
  // Default flag state per test: SOS enabled, test mode on. Tests
  // that want a different state flip the flag explicitly. Resetting
  // the in-process cache after each flip guarantees the next call
  // re-reads from Redis.
  await setFlag("sos_enabled", true, "test");
  await setFlag("sos_test_mode", true, "test");
  resetFlagCache?.();
});

describe("POST /api/v1/sos/trigger — kill switch", () => {
  it("returns 503 SOS_DISABLED when sos_enabled=false", async () => {
    await setFlag("sos_enabled", false, "test");
    resetFlagCache?.();

    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SOS_DISABLED");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/sos/trigger — happy path", () => {
  it("creates an SOSEvent and snapshots testMode=true", async () => {
    const clientUuid = randomUUID();

    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid,
        source: "patient_manual",
        locationLat: 12.9716,
        locationLng: 77.5946,
        locationAccuracyM: 25,
        lastReadings: { glucose: 38 },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(patientId);
    expect(res.body.data.escalationStage).toBe("stage_0_fullscreen");
    expect(res.body.data.testMode).toBe(true);
    expect(res.body.data.cancelledAt).toBeNull();
    expect(res.body.data.resolvedAt).toBeNull();

    const row = await prisma.sOSEvent.findUnique({ where: { clientUuid } });
    expect(row).toBeTruthy();
    expect(row.userId).toBe(patientId);
    expect(row.locationLat).toBe(12.9716);
    expect(row.lastReadings).toEqual({ glucose: 38 });
  });

  it("snapshots testMode=false when the flag is flipped at create time", async () => {
    await setFlag("sos_test_mode", false, "test");
    resetFlagCache?.();

    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });

    expect(res.status).toBe(200);
    expect(res.body.data.testMode).toBe(false);
  });

  it("works without optional location / lastReadings", async () => {
    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });

    expect(res.status).toBe(200);
    expect(res.body.data.escalationStage).toBe("stage_0_fullscreen");
  });
});

describe("POST /api/v1/sos/trigger — idempotency + source guard", () => {
  it("same clientUuid twice → same row, 200 both times", async () => {
    const clientUuid = randomUUID();

    const first = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid, source: "patient_manual" });

    const second = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid, source: "patient_manual" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await prisma.sOSEvent.count({ where: { clientUuid } });
    expect(count).toBe(1);
  });

  it("rejects non-patient_manual trigger sources until §D'.2 lands", async () => {
    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "guardian_initiated" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/sos/:id/cancel", () => {
  it("patient cancels their own SOS", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    const sosId = triggered.body.data.id;

    const res = await request(app)
      .post(`/api/v1/sos/${sosId}/cancel`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient" });

    expect(res.status).toBe(200);
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.cancelledBy).toBe("patient");
  });

  it("403 SOS_FORBIDDEN when another user tries to cancel", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    const sosId = triggered.body.data.id;

    const res = await request(app)
      .post(`/api/v1/sos/${sosId}/cancel`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ by: "patient" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SOS_FORBIDDEN");
  });

  it("404 SOS_NOT_FOUND for unknown id", async () => {
    const res = await request(app)
      .post(`/api/v1/sos/${randomUUID()}/cancel`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SOS_NOT_FOUND");
  });

  it("cancelling twice is idempotent — second cancel returns the same row", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    const sosId = triggered.body.data.id;

    const first = await request(app)
      .post(`/api/v1/sos/${sosId}/cancel`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient" });
    const second = await request(app)
      .post(`/api/v1/sos/${sosId}/cancel`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.cancelledAt).toBe(first.body.data.cancelledAt);
  });
});

describe("POST /api/v1/sos/:id/resolve", () => {
  it("patient resolves their own SOS with falseAlarm=true", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    const sosId = triggered.body.data.id;

    const res = await request(app)
      .post(`/api/v1/sos/${sosId}/resolve`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient", falseAlarm: true });

    expect(res.status).toBe(200);
    expect(res.body.data.resolvedAt).toBeTruthy();
    expect(res.body.data.resolvedBy).toBe("patient");
    expect(res.body.data.falseAlarm).toBe(true);
  });

  it("resolve omits falseAlarm and defaults to false", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });

    const res = await request(app)
      .post(`/api/v1/sos/${triggered.body.data.id}/resolve`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ by: "patient" });

    expect(res.status).toBe(200);
    expect(res.body.data.falseAlarm).toBe(false);
  });

  it("403 when a different user tries to resolve", async () => {
    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });

    const res = await request(app)
      .post(`/api/v1/sos/${triggered.body.data.id}/resolve`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ by: "patient" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/sos/active", () => {
  it("returns null when there is no active SOS for this user", async () => {
    // Pick a fresh user with no rows
    const fresh = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: { phone: "+919876543277", name: "Fresh", age: 50, householdId: fresh.id },
    });
    const token = sign(user.id, fresh.id);

    const res = await request(app)
      .get("/api/v1/sos/active")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBeNull();
  });

  it("returns the active SOS after trigger and null after resolve", async () => {
    // Fresh user per test — the shared `patientToken` accumulates SOS
    // rows across the suite (cancel / idempotency / source-guard
    // tests don't clean up), so `getActiveSOS` for the shared user
    // would surface a different row than the one this test just
    // resolved. A clean fixture is the simplest fix.
    const isolated = await prisma.household.create({ data: {} });
    const isolatedUser = await prisma.user.create({
      data: { phone: "+919876543288", name: "Isolated", age: 50, householdId: isolated.id },
    });
    const token = sign(isolatedUser.id, isolated.id);

    const triggered = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${token}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    const sosId = triggered.body.data.id;

    const active = await request(app)
      .get("/api/v1/sos/active")
      .set("Authorization", `Bearer ${token}`);
    expect(active.body.data.active.id).toBe(sosId);

    await request(app)
      .post(`/api/v1/sos/${sosId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ by: "patient" });

    const after = await request(app)
      .get("/api/v1/sos/active")
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.data.active).toBeNull();
  });
});
