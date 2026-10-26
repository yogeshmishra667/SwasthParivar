// Audit P11 — CLAUDE.md "Anti-Fatigue": the counters never moved (nothing
// recorded ignores or opens), and the cap table allowed unlimited pushes at
// levels 0–1. Now unopened habit pushes count as ignored, an open reported
// by the app resets fatigue, 2 logged days in a row reset it too, and a
// push is not sent for "time to check" after the user already logged today.
//
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

const { sendExpoPushMock } = vi.hoisted(() => ({ sendExpoPushMock: vi.fn() }));

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
let app: any;
let prisma: any;
let processUser: (userId: string, now: Date) => Promise<void>;

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
  const processorModule = await import("../../src/workers/notification-trigger.processor.js");
  app = appModule.buildApp();
  prisma = dbModule.prisma;
  processUser = processorModule.processNotificationTriggerUser;
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
  sendExpoPushMock.mockImplementation((messages: { to: string }[]) =>
    Promise.resolve(messages.map((m) => ({ token: m.to, success: true }))),
  );
});

// 07:30 IST.
const NOW = new Date("2026-10-26T02:00:00.000Z");
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const dayOnly = (daysBack: number): Date => new Date(Date.UTC(2026, 9, 26 - daysBack, 0, 0, 0));

const randomPhone = (): string => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

interface Seed {
  userId: string;
  token: string;
  householdId: string;
}

const seedUser = async (opts: {
  lastLogDaysBack: number;
  currentStreak?: number;
  state?: Record<string, unknown>;
}): Promise<Seed> => {
  const household = await prisma.household.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      phone: randomPhone(),
      name: "Ramesh ji",
      age: 64,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  await prisma.household.update({
    where: { id: household.id },
    data: { primaryUserId: user.id },
  });
  await prisma.pushToken.create({
    data: { userId: user.id, token: `ExponentPushToken[${randomUUID()}]`, platform: "android" },
  });
  await prisma.userStreak.create({
    data: {
      userId: user.id,
      currentStreakDays: opts.currentStreak ?? 0,
      longestStreakDays: opts.currentStreak ?? 0,
      lastLogDate: dayOnly(opts.lastLogDaysBack),
    },
  });
  await prisma.notificationState.create({ data: { userId: user.id, ...(opts.state ?? {}) } });
  const token = jwt.sign({ sub: user.id, householdId: household.id }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
  return { userId: user.id, token, householdId: household.id };
};

const stateOf = (userId: string) =>
  prisma.notificationState.findUniqueOrThrow({ where: { userId } });

const habitPush = (h: number, notificationId: string, extra: object = {}) => ({
  at: hoursAgo(h),
  type: "missed_day",
  messageKey: `notification.missed_day_${notificationId}`,
  notificationId,
  ...extra,
});

describe("the trigger job (audit P11)", () => {
  it("three unopened pushes count as ignored → fatigue 1, and a 2nd push that day is held back", async () => {
    const seed = await seedUser({
      lastLogDaysBack: 1,
      state: {
        notificationHistory7d: [habitPush(30, "a"), habitPush(20, "b"), habitPush(10, "c")],
      },
    });
    await processUser(seed.userId, NOW);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    const state = await stateOf(seed.userId);
    expect(state).toMatchObject({ consecutiveIgnores: 3, fatigueLevel: 1 });
    expect(
      (state.notificationHistory7d as { ignoredAt?: string }[]).every((h) => h.ignoredAt),
    ).toBe(true);
  });

  it("at level 0 a 3rd push within 24h is held back (max 2 a day)", async () => {
    const seed = await seedUser({
      lastLogDaysBack: 1,
      state: {
        notificationHistory7d: [
          habitPush(3, "a", { openedAt: hoursAgo(2) }),
          habitPush(2, "b", { openedAt: hoursAgo(1) }),
        ],
      },
    });
    await processUser(seed.userId, NOW);
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("a sent push carries its id, and history records the same id", async () => {
    const seed = await seedUser({ lastLogDaysBack: 1 });
    await processUser(seed.userId, NOW);

    const pushed = sendExpoPushMock.mock.calls[0]![0] as { data: { notificationId: string } }[];
    const state = await stateOf(seed.userId);
    const last = (state.notificationHistory7d as { notificationId?: string }[]).at(-1);
    expect(last?.notificationId).toBe(pushed[0]!.data.notificationId);
  });

  it("already logged today: no 'time to check' nudge at the best time", async () => {
    const logged = await seedUser({ lastLogDaysBack: 0, state: { bestLogTimeFasting: "07:30" } });
    await processUser(logged.userId, NOW);
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("a lapsed streak (last log 2 streak days ago) doesn't reset fatigue, across the 3 AM / IST boundary", async () => {
    // Wed 04:30 IST = Tue 23:00 UTC: only 47h after Monday's date in UTC
    // terms, but the streak day is Wednesday, so Tuesday was missed.
    const seed = await seedUser({
      lastLogDaysBack: 0,
      currentStreak: 2,
      state: { fatigueLevel: 3, consecutiveIgnores: 7 },
    });
    await prisma.userStreak.update({
      where: { userId: seed.userId },
      data: { lastLogDate: new Date(Date.UTC(2026, 9, 26)) },
    });
    await processUser(seed.userId, new Date("2026-10-27T23:00:00.000Z"));
    expect(await stateOf(seed.userId)).toMatchObject({ fatigueLevel: 3 });
  });

  it("logging 2 days in a row resets fatigue, even with nothing to send", async () => {
    const seed = await seedUser({
      lastLogDaysBack: 0,
      currentStreak: 2,
      state: { fatigueLevel: 3, consecutiveIgnores: 7 },
    });
    await processUser(seed.userId, NOW);
    expect(await stateOf(seed.userId)).toMatchObject({ fatigueLevel: 0, consecutiveIgnores: 0 });
  });
});

describe("POST /api/v1/notifications/opened (audit P11)", () => {
  it("resets fatigue and marks the push opened, so it is never counted as ignored", async () => {
    const seed = await seedUser({
      lastLogDaysBack: 1,
      state: {
        fatigueLevel: 2,
        consecutiveIgnores: 5,
        notificationHistory7d: [habitPush(10, "11111111-1111-4111-8111-111111111111")],
      },
    });
    const res = await request(app)
      .post("/api/v1/notifications/opened")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ notificationId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ matched: true });

    const state = await stateOf(seed.userId);
    expect(state).toMatchObject({ fatigueLevel: 0, consecutiveIgnores: 0 });
    expect((state.notificationHistory7d as { openedAt?: string }[])[0]!.openedAt).toBeTruthy();

    await processUser(seed.userId, NOW);
    expect((await stateOf(seed.userId)).consecutiveIgnores).toBe(0);
  });

  it("a household primary reports a sub-profile's open; another household's is refused", async () => {
    const seed = await seedUser({ lastLogDaysBack: 1 });
    const sub = await prisma.user.create({
      data: {
        phone: randomPhone(),
        name: "Maa ji",
        age: 61,
        householdId: seed.householdId,
        onboardingComplete: true,
      },
    });
    const pushId = randomUUID();
    await prisma.notificationState.create({
      data: { userId: sub.id, fatigueLevel: 3, notificationHistory7d: [habitPush(10, pushId)] },
    });
    const ok = await request(app)
      .post("/api/v1/notifications/opened")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ notificationId: pushId, targetUserId: sub.id });
    expect(ok.status).toBe(200);
    expect((await stateOf(sub.id)).fatigueLevel).toBe(0);

    const other = await seedUser({ lastLogDaysBack: 1 });
    const refused = await request(app)
      .post("/api/v1/notifications/opened")
      .set("Authorization", `Bearer ${other.token}`)
      .send({ notificationId: randomUUID(), targetUserId: sub.id });
    expect(refused.status).toBe(403);
  });

  it("an id that isn't one of this user's habit pushes changes nothing", async () => {
    const seed = await seedUser({ lastLogDaysBack: 1, state: { fatigueLevel: 2 } });
    const res = await request(app)
      .post("/api/v1/notifications/opened")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ notificationId: randomUUID() });
    expect(res.body.data).toEqual({ matched: false });
    expect((await stateOf(seed.userId)).fatigueLevel).toBe(2);
  });

  it("rejects a malformed id and needs auth", async () => {
    const seed = await seedUser({ lastLogDaysBack: 1 });
    const bad = await request(app)
      .post("/api/v1/notifications/opened")
      .set("Authorization", `Bearer ${seed.token}`)
      .send({ notificationId: "not-a-uuid" });
    expect(bad.status).toBe(400);
    const anon = await request(app)
      .post("/api/v1/notifications/opened")
      .send({ notificationId: randomUUID() });
    expect(anon.status).toBe(401);
  });
});
