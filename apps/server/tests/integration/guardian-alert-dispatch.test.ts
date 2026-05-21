// Phase 3 Feature C — GUARDIAN_ALERT_DISPATCH integration tests (C-4).
//
// Drives the dispatch processor directly against a real Postgres +
// Redis, with the two external notification surfaces (Expo push, MSG91
// SMS) mocked. Covers: the silent_guardian_alerts_dispatch flag gate,
// push-success, push-fail → SMS fallback, yellow → in-app only, the
// weekly orange cap, the critical-bypass 30-min dedup, and idempotency.

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import type { Job } from "bullmq";
import { makeGuardianAlert, type GuardianAlertFactoryShape } from "@swasth/test-factories";
import type { GuardianAlertDispatchJob } from "../../src/workers/guardian-alert-dispatch.processor.js";

// Mock the external notification surfaces — vi.hoisted so the spy
// instances exist before the mock factories evaluate.
const { sendExpoPushMock, sendSmsMock } = vi.hoisted(() => ({
  sendExpoPushMock: vi.fn(),
  sendSmsMock: vi.fn(),
}));
vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: sendExpoPushMock,
}));
vi.mock("../../src/shared/notifications/msg91-sms.js", () => ({
  sendSms: sendSmsMock,
}));

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
let prisma: any;
let dispatch: (alertId: string) => Promise<void>;
let setFlag: (key: string, value: boolean, by: string) => Promise<unknown>;
let resetFlagCache: () => void;

let guardianId: string;
const patient: Record<string, string> = {};

const HOUR = 3_600_000;
const NOW = Date.now();

const seedAlert = (
  patientId: string,
  overrides: Partial<GuardianAlertFactoryShape> = {},
): Promise<{ id: string }> =>
  prisma.guardianAlert.create({ data: makeGuardianAlert({ patientId, guardianId, ...overrides }) });

const pushOk = (): void => {
  sendExpoPushMock.mockResolvedValue([{ token: "ExponentPushToken[test]", success: true }]);
};
const pushFail = (): void => {
  sendExpoPushMock.mockResolvedValue([
    { token: "ExponentPushToken[test]", success: false, errorCode: "DeviceNotRegistered" },
  ]);
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

  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  const processorModule = await import("../../src/workers/guardian-alert-dispatch.processor.js");
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
  const run = processorModule.processGuardianAlertDispatch;
  dispatch = (alertId: string) => run({ data: { alertId } } as Job<GuardianAlertDispatchJob>);

  const household = await prisma.household.create({ data: {} });
  const mkUser = (name: string, phone: string): Promise<{ id: string }> =>
    prisma.user.create({
      data: { phone, name, age: 55, householdId: household.id, onboardingComplete: true },
    });

  const guardian = await mkUser("Suresh", "+919840000000");
  guardianId = guardian.id;
  await prisma.pushToken.create({
    data: { userId: guardianId, token: "ExponentPushToken[test]", platform: "ios" },
  });

  // One patient per scenario — keeps each test's (patient, guardian)
  // dispatch history isolated.
  const scenarios = ["flagOff", "pushOk", "pushFail", "yellow", "cap", "bypass"];
  for (let i = 0; i < scenarios.length; i++) {
    const u = await mkUser(`Patient ${i}`, `+91984000001${i}`);
    patient[scenarios[i]!] = u.id;
    await prisma.familyLink.create({
      data: { patientId: u.id, guardianId, status: "accepted", acceptedAt: new Date() },
    });
  }
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

beforeEach(() => {
  sendExpoPushMock.mockReset();
  sendSmsMock.mockReset();
});

describe("GUARDIAN_ALERT_DISPATCH", () => {
  it("delivers nothing while silent_guardian_alerts_dispatch is off (shadow mode)", async () => {
    const alert = await seedAlert(patient.flagOff!);
    await dispatch(alert.id);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.guardianAlert.findUnique({ where: { id: alert.id } });
    expect(row.sentVia).toEqual([]);
  });

  it("pushes an orange alert and records delivery once enabled", async () => {
    await setFlag("silent_guardian_alerts_dispatch", true, "test");
    resetFlagCache();
    pushOk();

    const alert = await seedAlert(patient.pushOk!, { severity: "orange" });
    await dispatch(alert.id);

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    const row = await prisma.guardianAlert.findUnique({ where: { id: alert.id } });
    expect(row.sentVia.sort()).toEqual(["in_app", "push"]);
    expect(row.pushDelivered).toBe(true);
    expect(row.smsDelivered).toBe(false);
  });

  it("is idempotent — a re-dispatch of a resolved alert does nothing", async () => {
    pushOk();
    const alert = await seedAlert(patient.pushOk!, { severity: "orange" });
    await dispatch(alert.id);
    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);

    sendExpoPushMock.mockClear();
    await dispatch(alert.id);
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("falls back to SMS when the push reaches no device", async () => {
    pushFail();
    sendSmsMock.mockResolvedValue({ phone: "+919840000000", success: true });

    const alert = await seedAlert(patient.pushFail!, { severity: "orange" });
    await dispatch(alert.id);

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const row = await prisma.guardianAlert.findUnique({ where: { id: alert.id } });
    expect(row.sentVia.sort()).toEqual(["in_app", "sms"]);
    expect(row.pushDelivered).toBe(false);
    expect(row.smsDelivered).toBe(true);
  });

  it("never pushes a yellow alert — in-app only", async () => {
    const alert = await seedAlert(patient.yellow!, { severity: "yellow" });
    await dispatch(alert.id);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.guardianAlert.findUnique({ where: { id: alert.id } });
    expect(row.sentVia).toEqual(["in_app"]);
  });

  it("suppresses a 3rd orange alert in the same week (weekly cap)", async () => {
    // Two orange alerts already pushed to this guardian-patient pair.
    await seedAlert(patient.cap!, {
      severity: "orange",
      sentVia: ["in_app", "push"],
      createdAt: new Date(NOW - 2 * HOUR),
    });
    await seedAlert(patient.cap!, {
      severity: "orange",
      sentVia: ["in_app", "push"],
      createdAt: new Date(NOW - 1 * HOUR),
    });

    const third = await seedAlert(patient.cap!, { severity: "orange" });
    await dispatch(third.id);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.guardianAlert.findUnique({ where: { id: third.id } });
    expect(row.sentVia).toEqual(["in_app"]);
  });

  it("suppresses a med-adherence orange when a critical-bypass fired in the last 30 min", async () => {
    await prisma.feedbackEvent.create({
      data: {
        userId: patient.bypass!,
        feedbackType: "critical_warn",
        tone: "gentle_warn",
        messageKey: "critical.high",
        variantIndex: 0,
        messageParams: {},
        shownAt: new Date(),
      },
    });

    const alert = await seedAlert(patient.bypass!, {
      severity: "orange",
      alertType: "med_adherence",
    });
    await dispatch(alert.id);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const row = await prisma.guardianAlert.findUnique({ where: { id: alert.id } });
    expect(row.sentVia).toEqual(["in_app"]);
  });
});
