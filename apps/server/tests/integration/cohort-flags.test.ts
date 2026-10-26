// Audit D3 — a cohort or percentage flag value is an object, which a
// `getFlag<boolean>` read treats as truthy: the API was ON for everyone
// while the app showed the feature to the cohort only. Each migrated gate
// is checked at the API for plain true/false (unchanged) and for a cohort
// in/out. Cohorts are keyed by the household's account (its primary), the
// id `GET /config/features` uses, so a sub-profile follows its account.
//
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: vi.fn((messages: { to: string }[]) =>
    Promise.resolve(messages.map((m) => ({ token: m.to, success: true }))),
  ),
}));
vi.mock("../../src/shared/notifications/msg91-sms.js", () => ({
  sendSmsBatch: vi.fn((messages: { phone: string }[]) =>
    Promise.resolve(messages.map((m) => ({ phone: m.phone, success: true }))),
  ),
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
let app: any;
let prisma: any;
let setFlag: (key: string, value: unknown, by: string) => Promise<unknown>;
let resetFlagCache: () => void;

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
      "SELECT create_hypertable('cardiac_logs', 'measured_at', if_not_exists => TRUE); " +
      "SELECT create_hypertable('respiratory_logs', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const flagsModule = await import("../../src/shared/flags/index.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  setFlag = flagsModule.setFlag as typeof setFlag;
  resetFlagCache = flagsModule.__resetFlagCache;
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

const flag = async (key: string, value: unknown): Promise<void> => {
  await setFlag(key, value, "integration_test");
  resetFlagCache();
};

const cohortOf = (...userIds: string[]) => ({ rollout: "cohort", userIds });

const randomPhone = (): string => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

interface Household {
  primaryId: string;
  subProfileId: string;
  token: string;
}

/** A household with its primary (who holds the JWT) and one sub-profile. */
const seedHousehold = async (): Promise<Household> => {
  const household = await prisma.household.create({ data: {} });
  const primary = await prisma.user.create({
    data: {
      phone: randomPhone(),
      name: "Ramesh ji",
      age: 64,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  const sub = await prisma.user.create({
    data: {
      phone: randomPhone(),
      name: "Maa ji",
      age: 61,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  await prisma.household.update({
    where: { id: household.id },
    data: { primaryUserId: primary.id },
  });
  const token = jwt.sign({ sub: primary.id, householdId: household.id }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
  return { primaryId: primary.id, subProfileId: sub.id, token };
};

interface Surface {
  flag: string;
  disabledCode: string;
  okStatus: number;
  /** `targetUserId` set → the call is made for that sub-profile. */
  call: (token: string, targetUserId?: string) => Promise<request.Response>;
}

const day = (): string =>
  `2026-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;

const SURFACES: Surface[] = [
  {
    flag: "cardiac_logging_enabled",
    disabledCode: "CARDIAC_DISABLED",
    okStatus: 201,
    call: (token, targetUserId) =>
      request(app)
        .post("/api/v1/readings/cardiac")
        .set("Authorization", `Bearer ${token}`)
        .send({
          clientUuid: randomUUID(),
          heartRate: 72,
          rhythmStatus: "regular",
          chestPain: false,
          exerciseTolerance: "normal",
          source: "manual",
          measuredAt: new Date().toISOString(),
          version: 1,
          ...(targetUserId ? { targetUserId } : {}),
        }),
  },
  {
    flag: "respiratory_logging_enabled",
    disabledCode: "RESPIRATORY_DISABLED",
    okStatus: 201,
    call: (token, targetUserId) =>
      request(app)
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
          ...(targetUserId ? { targetUserId } : {}),
        }),
  },
  {
    flag: "sleep_logging_enabled",
    disabledCode: "SLEEP_DISABLED",
    okStatus: 201,
    call: (token, targetUserId) =>
      request(app)
        .post("/api/v1/sleep")
        .set("Authorization", `Bearer ${token}`)
        .send({
          date: "2026-06-01",
          sleepStart: "2026-06-01T22:00:00.000Z",
          sleepEnd: "2026-06-02T06:00:00.000Z",
          durationMinutes: 480,
          quality: "good",
          source: "manual",
          ...(targetUserId ? { targetUserId } : {}),
        }),
  },
  {
    flag: "activity_logging_enabled",
    disabledCode: "ACTIVITY_DISABLED",
    okStatus: 201,
    call: (token) =>
      request(app).post("/api/v1/activity/daily").set("Authorization", `Bearer ${token}`).send({
        date: day(),
        steps: 4000,
        distanceMeters: 3000,
        activeMinutes: 30,
        source: "manual",
      }),
  },
  {
    flag: "doctor_portal_enabled",
    disabledCode: "DOCTOR_PORTAL_DISABLED",
    okStatus: 200,
    call: (token) => request(app).get("/api/v1/doctors").set("Authorization", `Bearer ${token}`),
  },
  {
    flag: "sos_enabled",
    disabledCode: "SOS_DISABLED",
    okStatus: 200,
    call: (token) =>
      request(app)
        .post("/api/v1/sos/trigger")
        .set("Authorization", `Bearer ${token}`)
        .send({ clientUuid: randomUUID(), source: "patient_manual" }),
  },
];

describe.each(SURFACES)("$flag (audit D3)", (surface) => {
  const expectOk = (res: request.Response): void => {
    expect(res.status, JSON.stringify(res.body)).toBe(surface.okStatus);
  };
  const expectDisabled = (res: request.Response): void => {
    expect(res.body.error?.code, JSON.stringify(res.body)).toBe(surface.disabledCode);
  };

  it("plain true → on for everyone; plain false → off for everyone (unchanged)", async () => {
    const a = await seedHousehold();
    await flag(surface.flag, true);
    expectOk(await surface.call(a.token));
    const b = await seedHousehold();
    await flag(surface.flag, false);
    expectDisabled(await surface.call(b.token));
  });

  it("a cohort is on for its household and off for everyone else", async () => {
    const inside = await seedHousehold();
    const outside = await seedHousehold();
    await flag(surface.flag, cohortOf(inside.primaryId));
    expectOk(await surface.call(inside.token));
    expectDisabled(await surface.call(outside.token));
  });

  it("a 0% rollout is off; 100% is on", async () => {
    const a = await seedHousehold();
    await flag(surface.flag, { rollout: "percentage", percent: 0 });
    expectDisabled(await surface.call(a.token));
    await flag(surface.flag, { rollout: "percentage", percent: 100 });
    const b = await seedHousehold();
    expectOk(await surface.call(b.token));
  });
});

describe.each(
  SURFACES.filter(
    (s) => s.flag.endsWith("_logging_enabled") && s.flag !== "activity_logging_enabled",
  ),
)("$flag for a sub-profile (audit D3)", (surface) => {
  it("follows its household account's cohort", async () => {
    const inside = await seedHousehold();
    const outside = await seedHousehold();
    await flag(surface.flag, cohortOf(inside.primaryId));
    const res = await surface.call(inside.token, inside.subProfileId);
    expect(res.status, JSON.stringify(res.body)).toBe(surface.okStatus);
    const other = await surface.call(outside.token, outside.subProfileId);
    expect(other.body.error?.code).toBe(surface.disabledCode);
  });
});

describe("SOS test mode (audit D3)", () => {
  beforeEach(async () => {
    await flag("sos_enabled", true);
    await flag("sos_real_mode_enabled", false);
  });

  const trigger = async (h: Household): Promise<{ testMode: boolean }> => {
    const res = await request(app)
      .post("/api/v1/sos/trigger")
      .set("Authorization", `Bearer ${h.token}`)
      .send({ clientUuid: randomUUID(), source: "patient_manual" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return await prisma.sOSEvent.findUniqueOrThrow({ where: { id: res.body.data.id } });
  };

  it("defaults to test mode", async () => {
    const redisModule = await import("../../src/shared/redis.js");
    await redisModule.redis?.del("flag:sos_test_mode");
    resetFlagCache();
    expect((await trigger(await seedHousehold())).testMode).toBe(true);
  });

  it("plain sos_test_mode=false is real mode for everyone; true is test mode (unchanged)", async () => {
    await flag("sos_test_mode", false);
    expect((await trigger(await seedHousehold())).testMode).toBe(false);
    await flag("sos_test_mode", true);
    expect((await trigger(await seedHousehold())).testMode).toBe(true);
  });

  it("sos_real_mode_enabled for a drill cohort: real mode for that household only", async () => {
    const drill = await seedHousehold();
    const other = await seedHousehold();
    await flag("sos_test_mode", true);
    await flag("sos_real_mode_enabled", cohortOf(drill.primaryId));
    expect((await trigger(drill)).testMode).toBe(false);
    expect((await trigger(other)).testMode).toBe(true);
  });

  it("a cohort on sos_test_mode itself keeps test mode, and SOS still triggers", async () => {
    const h = await seedHousehold();
    await flag("sos_test_mode", cohortOf(h.primaryId));
    expect((await trigger(h)).testMode).toBe(true);
  });
});

describe("SOS auto-escalation and escalation ticks (audit D3)", () => {
  it("auto-escalation from a critical reading follows the cohort", async () => {
    const { autoTriggerSOSFromCriticalBypass } =
      await import("../../src/modules/sos/sos.service.js");
    const inside = await seedHousehold();
    const outside = await seedHousehold();
    await flag("sos_enabled", cohortOf(inside.primaryId));
    await flag("sos_source_critical_bypass_enabled", cohortOf(inside.primaryId));
    expect(
      await autoTriggerSOSFromCriticalBypass({ userId: inside.primaryId, readingId: randomUUID() }),
    ).not.toBeNull();
    expect(
      await autoTriggerSOSFromCriticalBypass({
        userId: outside.primaryId,
        readingId: randomUUID(),
      }),
    ).toBeNull();
    await flag("sos_source_critical_bypass_enabled", false);
  });

  it("an escalation tick runs for a household in the cohort and stops outside it", async () => {
    const { processSOSEscalation } = await import("../../src/workers/sos-escalation.processor.js");
    const inside = await seedHousehold();
    const outside = await seedHousehold();
    await flag("sos_enabled", cohortOf(inside.primaryId));

    const seedEvent = async (h: Household): Promise<string> => {
      await prisma.emergencyContact.create({
        data: {
          userId: h.primaryId,
          name: "Beta",
          phone: randomPhone(),
          relationship: "son",
          priority: 1,
          isGuardian: true,
        },
      });
      const ev = await prisma.sOSEvent.create({
        data: {
          clientUuid: randomUUID(),
          userId: h.primaryId,
          triggerSource: "patient_manual",
          testMode: true,
          triggeredAt: new Date(Date.now() - 10 * 60_000),
        },
      });
      return ev.id as string;
    };
    const tick = async (id: string): Promise<string> => {
      await processSOSEscalation({ id: `tick-${id}`, data: { sosEventId: id } } as never);
      const row = await prisma.sOSEvent.findUniqueOrThrow({ where: { id } });
      return row.escalationStage as string;
    };

    expect(await tick(await seedEvent(inside))).not.toBe("stage_0_fullscreen");
    expect(await tick(await seedEvent(outside))).toBe("stage_0_fullscreen");
  });
});
