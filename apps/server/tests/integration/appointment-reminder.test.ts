// Phase 4 Feature G.3 — APPOINTMENT_REMINDER processor integration tests.
//
// Drives `processAppointmentReminder` directly (not the worker, so no
// BullMQ listener starts) against a real Postgres/Redis. Expo push is
// mocked at module level — we assert the worker fires the right window,
// flips exactly the matching sent-flag, is idempotent across re-runs,
// and respects the `doctor_portal_enabled` kill-switch.

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";

const { sendExpoPushMock } = vi.hoisted(() => ({
  sendExpoPushMock: vi.fn(),
}));
vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: sendExpoPushMock,
}));

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
let prisma: any;
let processAppointmentReminder: (job: any) => Promise<void>;
let setFlag: (key: string, value: boolean, actor: string) => Promise<unknown>;
let resetFlagCache: () => void;

let patientId: string;
let doctorId: string;

const setPortal = async (enabled: boolean): Promise<void> => {
  await setFlag("doctor_portal_enabled", enabled, "integration_test");
  resetFlagCache();
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

const makeAppt = async (msFromNow: number): Promise<string> => {
  const appt = await prisma.doctorAppointment.create({
    data: {
      userId: patientId,
      doctorId,
      scheduledAt: new Date(Date.now() + msFromNow),
      purpose: "Review",
    },
  });
  return appt.id as string;
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

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const procModule = await import("../../src/workers/appointment-reminder.processor.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  processAppointmentReminder = procModule.processAppointmentReminder;

  await setPortal(true);

  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: "+919812370010",
      name: "Ramesh",
      age: 65,
      householdId: household.id,
      preferredLanguage: "hi",
      onboardingComplete: true,
    },
  });
  patientId = patient.id;
  const doctor = await prisma.doctorProfile.create({
    data: { userId: patientId, name: "Dr. Mehta", specialty: "Endocrinology" },
  });
  doctorId = doctor.id;
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
  sendExpoPushMock.mockReset();
  sendExpoPushMock.mockResolvedValue([{ token: "stub", success: true }]);
  await prisma.doctorAppointment.deleteMany({ where: { userId: patientId } });
  await prisma.pushToken.deleteMany({ where: { userId: patientId } });
  await setPortal(true);
});

const registerToken = async (): Promise<void> => {
  await prisma.pushToken.create({
    data: { userId: patientId, token: `ExponentPushToken[${Date.now()}]`, platform: "android" },
  });
};

describe("processAppointmentReminder — kill-switch", () => {
  it("no-ops when doctor_portal_enabled is off", async () => {
    await registerToken();
    const id = await makeAppt(3 * DAY);
    await setPortal(false);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent7d).toBe(false);
  });
});

describe("processAppointmentReminder — window firing", () => {
  it("fires the 7d window for an appointment 3 days out and pushes once", async () => {
    await registerToken();
    const id = await makeAppt(3 * DAY);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent7d).toBe(true);
    expect(row.reminderSent1d).toBe(false);
    expect(row.reminderSent2h).toBe(false);
  });

  it("fires only the 2h window for an appointment 1 hour out", async () => {
    await registerToken();
    const id = await makeAppt(1 * HOUR);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent2h).toBe(true);
    expect(row.reminderSent7d).toBe(false);
    expect(row.reminderSent1d).toBe(false);
  });

  it("is idempotent — a second tick in the same bucket does not re-push", async () => {
    await registerToken();
    await makeAppt(3 * DAY);
    await processAppointmentReminder({ data: { tick: true } });
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
  });

  it("flips the sent-flag even with zero push tokens (no infinite re-scan)", async () => {
    // No token registered.
    const id = await makeAppt(3 * DAY);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent7d).toBe(true);
  });

  it("ignores appointments beyond the 7-day horizon", async () => {
    await registerToken();
    const id = await makeAppt(10 * DAY);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent7d).toBe(false);
  });

  it("ignores past appointments", async () => {
    await registerToken();
    const id = await makeAppt(-2 * HOUR);
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.doctorAppointment.findUnique({ where: { id } });
    expect(row.reminderSent2h).toBe(false);
  });

  it("skips non-scheduled (e.g. cancelled) appointments", async () => {
    await registerToken();
    const id = await makeAppt(3 * DAY);
    await prisma.doctorAppointment.update({ where: { id }, data: { status: "cancelled" } });
    await processAppointmentReminder({ data: { tick: true } });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });
});
