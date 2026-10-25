import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock the two external notification surfaces at module level. vi.mock is
// hoisted to the top of the file; we use vi.hoisted to make the spy
// instances exist BEFORE the mock factories evaluate (otherwise the
// factory captures undefined and `sendExpoPush()` returns undefined at
// runtime).
const { sendExpoPushMock, sendSmsBatchMock, captureUnhandledMock } = vi.hoisted(() => ({
  sendExpoPushMock: vi.fn(),
  sendSmsBatchMock: vi.fn(),
  captureUnhandledMock: vi.fn(),
}));

vi.mock("../../src/shared/notifications/expo-push.js", () => ({
  sendExpoPush: sendExpoPushMock,
}));
vi.mock("../../src/shared/notifications/msg91-sms.js", () => ({
  sendSmsBatch: sendSmsBatchMock,
}));
// Stub Sentry so the "reached no recipient" capture is observable
// without a real DSN. All exports are replaced — app.js taps
// captureUnhandled from its error handler.
vi.mock("../../src/shared/observability/sentry.js", () => ({
  captureUnhandled: captureUnhandledMock,
  initSentry: vi.fn(),
  isSentryEnabled: vi.fn(() => false),
  warnIfMisconfigured: vi.fn(),
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
let processCriticalAlert: (job: { data: any; id?: string }) => Promise<void>;

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
  // Import the PROCESSOR module (no side effects) — the companion
  // .worker.ts would start a real BullMQ listener that races with the
  // test's direct processor invocation and double-consumes mock calls.
  const processorModule = await import("../../src/workers/critical-alert.processor.js");

  app = appModule.buildApp();
  prisma = dbModule.prisma;
  processCriticalAlert = processorModule.processCriticalAlert;
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
  sendSmsBatchMock.mockReset();
  captureUnhandledMock.mockReset();
});

interface TestFixture {
  patientId: string;
  patientToken: string;
  guardianId: string;
  guardianContactId: string;
}

const seedPatientWithGuardian = async (): Promise<TestFixture> => {
  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Ramesh Test",
      age: 65,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  // The guardian has their own account, so their own household. A
  // guardian inside the patient's household shares the patient's device
  // and is texted regardless of push (see the hardening suite below).
  const guardianHousehold = await prisma.household.create({ data: {} });
  const guardian = await prisma.user.create({
    data: {
      phone: `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      name: "Priya Test",
      age: 35,
      householdId: guardianHousehold.id,
      onboardingComplete: true,
    },
  });
  // Emergency contact whose phone matches the guardian user — the worker
  // resolves push tokens via this lookup.
  const contact = await prisma.emergencyContact.create({
    data: {
      userId: patient.id,
      name: "Priya Test",
      phone: guardian.phone,
      relationship: "daughter",
      priority: 1,
      isGuardian: true,
    },
  });
  await prisma.pushToken.create({
    data: {
      userId: guardian.id,
      token: `ExponentPushToken[${randomUUID()}]`,
      platform: "android",
    },
  });
  const token = jwt.sign({ sub: patient.id, householdId: household.id }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
  return {
    patientId: patient.id,
    patientToken: token,
    guardianId: guardian.id,
    guardianContactId: contact.id,
  };
};

const fetchEnqueuedJob = async (readingId: string): Promise<any> => {
  const queueModule = await import("../../src/shared/queue.js");
  const { Queue } = await import("bullmq");
  const { Redis } = await import("ioredis");
  const conn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const probeQueue = new Queue(queueModule.QUEUE_NAMES.CRITICAL_ALERT, { connection: conn });
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const jobs = await probeQueue.getJobs(["waiting", "active", "delayed", "completed"], 0, 100);
      const match = jobs.find((j: any) => j.data?.readingId === readingId);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  } finally {
    await probeQueue.close();
    await conn.quit();
  }
};

describe("Critical-bypass full chain (HTTP → service → queue → worker → push/SMS)", () => {
  it("low-glucose POST: push succeeds → SMS NOT triggered", async () => {
    const { patientId, patientToken } = await seedPatientWithGuardian();

    sendExpoPushMock.mockResolvedValueOnce([{ token: "stub", success: true }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 48,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(true);
    expect(res.body.data.critical.severity).toBe("low");

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();
    expect(job.data.userId).toBe(patientId);

    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    const pushArgs = sendExpoPushMock.mock.calls[0]![0] as {
      title: string;
      body: string;
      data: { type: string; severity: string };
    }[];
    expect(pushArgs.length).toBeGreaterThan(0);
    expect(pushArgs[0]!.title).toContain("Bahut Kam");
    expect(pushArgs[0]!.body).toContain("48");
    expect(pushArgs[0]!.data.type).toBe("critical_alert");
    expect(pushArgs[0]!.data.severity).toBe("low");

    expect(sendSmsBatchMock).not.toHaveBeenCalled();
    // Push delivered → the alert reached a recipient → no Sentry page.
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("high-glucose POST: push fails → SMS fallback triggered", async () => {
    const { patientId: _patientId, patientToken } = await seedPatientWithGuardian();

    sendExpoPushMock.mockResolvedValueOnce([
      { token: "stub", success: false, errorCode: "DeviceNotRegistered" },
    ]);
    sendSmsBatchMock.mockResolvedValueOnce([{ phone: "+91XXXX", success: true }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 330,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.severity).toBe("high");
    expect(res.body.data.critical.showFullscreenAlert).toBe(true);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();

    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    expect(sendSmsBatchMock).toHaveBeenCalledTimes(1);
    const smsArgs = sendSmsBatchMock.mock.calls[0]![0] as { phone: string; message: string }[];
    expect(smsArgs[0]!.message).toContain("BAHUT ZYADA");
    expect(smsArgs[0]!.message).toContain("330");
    // SMS fallback delivered → a recipient was reached → no Sentry page.
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("high-glucose POST: push fails AND SMS fails → Sentry capture fires (reached no one)", async () => {
    const { patientToken } = await seedPatientWithGuardian();

    sendExpoPushMock.mockResolvedValueOnce([
      { token: "stub", success: false, errorCode: "DeviceNotRegistered" },
    ]);
    sendSmsBatchMock.mockResolvedValue([{ phone: "+91XXXX", success: false }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 330,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();

    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalledTimes(1);
    // First attempt + 3 retries (CLAUDE.md "SMS fails → retry 3x").
    expect(sendSmsBatchMock).toHaveBeenCalledTimes(4);
    // Both channels delivered to zero recipients — on-call must be paged.
    expect(captureUnhandledMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureUnhandledMock.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect((ctx as { severity: string }).severity).toBe("high");
  });

  it("preserves requestId from HTTP request through queue payload", async () => {
    const { patientToken } = await seedPatientWithGuardian();
    sendExpoPushMock.mockResolvedValue([{ token: "stub", success: true }]);

    const reqId = `test-req-${randomUUID()}`;
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Request-Id", reqId)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();
    expect(job.data.requestId).toBe(reqId);
  });

  it("normal-range reading: NO queue job is enqueued and NO notifications fire", async () => {
    const { patientToken } = await seedPatientWithGuardian();

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 110,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.isCritical).toBe(false);

    // Brief wait so a (wrongly-)enqueued job has a chance to land in Redis.
    await new Promise((r) => setTimeout(r, 300));
    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).toBeNull();
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    expect(sendSmsBatchMock).not.toHaveBeenCalled();
  });

  it("solo patient (no guardian contact): patient's own device still gets the push", async () => {
    // Regression for the bug where `pushTargets.length === 0` short-circuited
    // the entire push branch, so a solo patient (no family link) never
    // got the fullscreen-alert push and had to notice the reading visually.
    const household = await prisma.household.create({ data: {} });
    const patient = await prisma.user.create({
      data: {
        phone: `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: "Solo Patient",
        age: 70,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    // Patient HAS a device registered, but NO emergency contacts and
    // NO guardian. Previously this combination produced zero push.
    const patientPushToken = `ExponentPushToken[${randomUUID()}]`;
    await prisma.pushToken.create({
      data: { userId: patient.id, token: patientPushToken, platform: "android" },
    });
    const patientToken = jwt.sign(
      { sub: patient.id, householdId: household.id },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    sendExpoPushMock.mockResolvedValueOnce([{ token: patientPushToken, success: true }]);

    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 50,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.body.data.critical.isCritical).toBe(true);

    const job = await fetchEnqueuedJob(res.body.data.reading.id);
    expect(job).not.toBeNull();
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendExpoPushMock).toHaveBeenCalled();
    const firstCall = sendExpoPushMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const messages = firstCall![0] as { to: string }[];
    expect(messages.map((m) => m.to)).toContain(patientPushToken);
  });

  it("threshold boundary: 65 mg/dL is NOT critical, 64 mg/dL IS critical", async () => {
    // CLAUDE.md: "Thresholds HARDCODED. Not configurable. Medical safety."
    // This test exists so a future change to the threshold constants
    // breaks the test loudly rather than slipping through review.
    const { patientToken } = await seedPatientWithGuardian();

    const at65 = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 65,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(at65.body.data.critical.isCritical).toBe(false);

    const at64 = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 64,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(at64.body.data.critical.isCritical).toBe(true);
    expect(at64.body.data.critical.severity).toBe("low");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-contact SMS — CLAUDE.md edge case #3 / audit P1.
// "Push to ALL guardian contacts (who have app). SMS only to contacts
// where push failed." A contact is reached only by a push to a device
// owned by the user whose phone IS that contact's phone — a successful
// push to the patient's own device must never suppress SMS to contacts.
// ─────────────────────────────────────────────────────────────

const randomPhone = (prefix: string): string =>
  `+91${prefix}${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

interface ContactSpec {
  /** "app": a guardian with their own account + device; "no_app": phone matches no user. */
  readonly kind: "app" | "no_app";
  readonly isGuardian: boolean;
  readonly priority: number;
}

interface SeededContact {
  readonly id: string;
  readonly phone: string;
  /** Push token of the contact's own device (only for kind "app"). */
  readonly token: string | null;
}

const seedPatientWithContacts = async (
  contacts: readonly ContactSpec[],
): Promise<{
  patientId: string;
  patientToken: string;
  patientDeviceToken: string;
  contacts: SeededContact[];
}> => {
  const household = await prisma.household.create({ data: {} });
  const patient = await prisma.user.create({
    data: {
      phone: randomPhone("95"),
      name: "Kamla Test",
      age: 68,
      householdId: household.id,
      onboardingComplete: true,
    },
  });
  // The patient's own phone has the app registered.
  const patientDeviceToken = `ExponentPushToken[${randomUUID()}]`;
  await prisma.pushToken.create({
    data: { userId: patient.id, token: patientDeviceToken, platform: "android" },
  });

  const seeded: SeededContact[] = [];
  for (const spec of contacts) {
    const phone = randomPhone("94");
    let token: string | null = null;
    if (spec.kind === "app") {
      // A family member with their own account in their OWN household.
      const ownHousehold = await prisma.household.create({ data: {} });
      const user = await prisma.user.create({
        data: {
          phone,
          name: "Guardian Test",
          age: 38,
          householdId: ownHousehold.id,
          onboardingComplete: true,
        },
      });
      token = `ExponentPushToken[${randomUUID()}]`;
      await prisma.pushToken.create({ data: { userId: user.id, token, platform: "android" } });
    }
    const row = await prisma.emergencyContact.create({
      data: {
        userId: patient.id,
        name: `Contact ${spec.priority}`,
        phone,
        relationship: "son",
        priority: spec.priority,
        isGuardian: spec.isGuardian,
      },
    });
    seeded.push({ id: row.id, phone, token });
  }

  const patientToken = jwt.sign(
    { sub: patient.id, householdId: household.id },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" },
  );
  return { patientId: patient.id, patientToken, patientDeviceToken, contacts: seeded };
};

/** Push mock: every message succeeds unless its token is in `failing`. */
const pushResults =
  (failing: readonly string[] = []) =>
  (messages: { to: string }[]) =>
    Promise.resolve(messages.map((m) => ({ token: m.to, success: !failing.includes(m.to) })));

/** SMS mock: every message succeeds unless its phone is in `failing`. */
const smsResults =
  (failing: readonly string[] = []) =>
  (messages: { phone: string }[]) =>
    Promise.resolve(messages.map((m) => ({ phone: m.phone, success: !failing.includes(m.phone) })));

const postCriticalGlucose = async (patientToken: string, valueMgDl: number): Promise<any> => {
  const res = await request(app)
    .post("/api/v1/readings/glucose")
    .set("Authorization", `Bearer ${patientToken}`)
    .send({
      clientUuid: randomUUID(),
      valueMgDl,
      readingType: "fasting",
      context: "normal",
      source: "manual",
      measuredAt: new Date().toISOString(),
      version: 1,
    });
  expect(res.status).toBe(201);
  expect(res.body.data.critical.isCritical).toBe(true);
  const job = await fetchEnqueuedJob(res.body.data.reading.id);
  expect(job).not.toBeNull();
  return job;
};

const smsPhones = (): string[] =>
  sendSmsBatchMock.mock.calls.flatMap((call) =>
    (call[0] as { phone: string }[]).map((m) => m.phone),
  );

describe("Critical-bypass per-contact SMS (edge case #3 / audit P1)", () => {
  it("patient's own push succeeds → contacts WITHOUT the app are still texted", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "no_app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults());

    const job = await postCriticalGlucose(seed.patientToken, 45);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    // The patient's own device got the push…
    const pushed = (sendExpoPushMock.mock.calls[0]![0] as { to: string }[]).map((m) => m.to);
    expect(pushed).toContain(seed.patientDeviceToken);
    // …and BOTH contacts were texted, in priority order.
    expect(smsPhones()).toEqual([seed.contacts[0]!.phone, seed.contacts[1]!.phone]);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("guardian reached on their own device is not texted; contact without the app is", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults());

    const job = await postCriticalGlucose(seed.patientToken, 340);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    const pushed = (sendExpoPushMock.mock.calls[0]![0] as { to: string }[]).map((m) => m.to);
    expect(pushed).toEqual(
      expect.arrayContaining([seed.patientDeviceToken, seed.contacts[0]!.token]),
    );
    expect(smsPhones()).toEqual([seed.contacts[1]!.phone]);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("only the guardian whose push FAILED is texted", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "app", isGuardian: true, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults([seed.contacts[1]!.token!]));
    sendSmsBatchMock.mockImplementation(smsResults());

    const job = await postCriticalGlucose(seed.patientToken, 50);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(smsPhones()).toEqual([seed.contacts[1]!.phone]);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("every contact reached by their own push → no SMS", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "app", isGuardian: true, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());

    const job = await postCriticalGlucose(seed.patientToken, 330);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendSmsBatchMock).not.toHaveBeenCalled();
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("contacts exist but only the patient's own device was reached → on-call is paged", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "no_app", isGuardian: false, priority: 1 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    // SMS provider down: the contact is unreachable.
    sendSmsBatchMock.mockImplementation(smsResults([seed.contacts[0]!.phone]));

    const job = await postCriticalGlucose(seed.patientToken, 40);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    // First attempt + 3 retries, all to the one contact.
    expect(smsPhones()).toEqual(Array(4).fill(seed.contacts[0]!.phone));
    // A successful push to the patient's own phone must not mask that no
    // emergency contact was reached.
    expect(captureUnhandledMock).toHaveBeenCalledTimes(1);
  });

  it("within the cooldown window → no push and no SMS (fullscreen only)", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "no_app", isGuardian: false, priority: 1 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults());

    const first = await postCriticalGlucose(seed.patientToken, 45);
    await processCriticalAlert({ data: first.data, id: String(first.id) });
    sendExpoPushMock.mockClear();
    sendSmsBatchMock.mockClear();

    // Second critical reading moments later — inside the 30-min cooldown:
    // the app still shows the fullscreen alert, but no dispatch is queued.
    const res = await request(app)
      .post("/api/v1/readings/glucose")
      .set("Authorization", `Bearer ${seed.patientToken}`)
      .send({
        clientUuid: randomUUID(),
        valueMgDl: 44,
        readingType: "fasting",
        context: "normal",
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.critical.withinCooldown).toBe(true);
    expect(res.body.data.critical.showFullscreenAlert).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await fetchEnqueuedJob(res.body.data.reading.id)).toBeNull();

    // Defence in depth: the processor itself sends nothing for a
    // cooldown decision, even with contacts that lack the app.
    await processCriticalAlert({
      id: randomUUID(),
      data: {
        readingId: res.body.data.reading.id,
        userId: seed.patientId,
        decision: res.body.data.critical,
      },
    });
    expect(sendExpoPushMock).not.toHaveBeenCalled();
    expect(sendSmsBatchMock).not.toHaveBeenCalled();
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("cardiac dispatch uses the same rule: contact without the app is texted", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults());

    await processCriticalAlert({
      id: randomUUID(),
      data: {
        category: "cardiac",
        readingId: randomUUID(),
        userId: seed.patientId,
        dispatch: {
          category: "cardiac",
          withinCooldown: false,
          showFullscreenAlert: true,
          showCallButton: true,
          triggerPush: true,
          triggerSmsFallback: true,
          pushTargets: [seed.contacts[0]!.id],
          smsTargets: [seed.contacts[0]!.id, seed.contacts[1]!.id],
          copyKey: "critical.cardiac.hr_high",
        },
        copyParams: { heartRateBpm: 172 },
      },
    });

    expect(smsPhones()).toEqual([seed.contacts[1]!.phone]);
    const sms = sendSmsBatchMock.mock.calls[0]![0] as { message: string }[];
    expect(sms[0]!.message).toContain("172");
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Delivery hardening — the remaining ways a contact could miss the SMS
// (P1 safety review): a contact sharing the patient's device, a push stage
// that throws, and transient SMS failures.
// ─────────────────────────────────────────────────────────────

/** Glucose bypass decision outside the cooldown, every contact a target. */
const criticalLowDecision = (guardianIds: readonly string[], contactIds: readonly string[]) => ({
  isCritical: true,
  severity: "low" as const,
  withinCooldown: false,
  showFullscreenAlert: true,
  triggerPush: true,
  triggerSmsFallback: true,
  showCallButton: true,
  pushTargets: [...guardianIds],
  smsTargets: [...contactIds],
  copyKey: "critical.low" as const,
});

describe("Critical-bypass delivery hardening", () => {
  it("sub-profile: the seeded primary contact on the SHARED device is still texted", async () => {
    // Shared phone: the household primary owns the device's only push
    // token; the sub-profile's priority-1 contact is that same primary
    // (auto-seeded by POST /household/profiles).
    const household = await prisma.household.create({ data: {} });
    const primary = await prisma.user.create({
      data: {
        phone: randomPhone("93"),
        name: "Suresh Test",
        age: 42,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { primaryUserId: primary.id },
    });
    const subProfile = await prisma.user.create({
      data: {
        phone: randomPhone("92"),
        name: "Maa Test",
        age: 70,
        householdId: household.id,
        onboardingComplete: true,
      },
    });
    const sharedDeviceToken = `ExponentPushToken[${randomUUID()}]`;
    await prisma.pushToken.create({
      data: { userId: primary.id, token: sharedDeviceToken, platform: "android" },
    });
    const contact = await prisma.emergencyContact.create({
      data: {
        userId: subProfile.id,
        name: primary.name,
        phone: primary.phone,
        relationship: "guardian",
        priority: 1,
        isGuardian: true,
      },
    });
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults());

    await processCriticalAlert({
      id: randomUUID(),
      data: {
        readingId: randomUUID(),
        userId: subProfile.id,
        decision: criticalLowDecision([contact.id], [contact.id]),
      },
    });

    // The shared device shows the alert…
    const pushed = (sendExpoPushMock.mock.calls[0]![0] as { to: string }[]).map((m) => m.to);
    expect(pushed).toEqual([sharedDeviceToken]);
    // …but that push lands on the patient's own phone, so it proves
    // nothing about the primary — they are texted too.
    expect(smsPhones()).toEqual([primary.phone]);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("push stage throws → every contact is texted and on-call is paged", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockRejectedValue(new Error("expo client exploded"));
    sendSmsBatchMock.mockImplementation(smsResults());

    const job = await postCriticalGlucose(seed.patientToken, 42);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(smsPhones()).toEqual([seed.contacts[0]!.phone, seed.contacts[1]!.phone]);
    expect(captureUnhandledMock).toHaveBeenCalledTimes(1);
    const [, ctx] = captureUnhandledMock.mock.calls[0]!;
    expect((ctx as { stage: string }).stage).toBe("critical_alert_push");
  });

  it("transient SMS failure is retried for that contact only, then delivered", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "no_app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    const flaky = seed.contacts[0]!.phone;
    let flakyAttempts = 0;
    sendSmsBatchMock.mockImplementation((messages: { phone: string }[]) =>
      Promise.resolve(
        messages.map((m) => {
          if (m.phone !== flaky) return { phone: m.phone, success: true };
          flakyAttempts++;
          return { phone: m.phone, success: flakyAttempts > 2 };
        }),
      ),
    );

    const job = await postCriticalGlucose(seed.patientToken, 330);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendSmsBatchMock.mock.calls.map((call) => call[0].map((m: any) => m.phone))).toEqual([
      [flaky, seed.contacts[1]!.phone],
      [flaky],
      [flaky],
    ]);
    expect(captureUnhandledMock).not.toHaveBeenCalled();
  });

  it("a contact's SMS still failing after every retry pages on-call", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "app", isGuardian: true, priority: 1 },
      { kind: "no_app", isGuardian: false, priority: 2 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation(smsResults([seed.contacts[1]!.phone]));

    const job = await postCriticalGlucose(seed.patientToken, 330);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(smsPhones()).toEqual(Array(4).fill(seed.contacts[1]!.phone));
    // The guardian was reached, so this is not "reached no one" — but a
    // contact without the app was never told, so on-call still hears.
    expect(captureUnhandledMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureUnhandledMock.mock.calls[0]!;
    expect((err as Error).message).toBe("critical bypass SMS failed after retries");
    expect((ctx as { smsFailed: number }).smsFailed).toBe(1);
  });

  it("SMS provider not configured → no pointless retries, on-call paged", async () => {
    const seed = await seedPatientWithContacts([
      { kind: "no_app", isGuardian: false, priority: 1 },
    ]);
    sendExpoPushMock.mockImplementation(pushResults());
    sendSmsBatchMock.mockImplementation((messages: { phone: string }[]) =>
      Promise.resolve(
        messages.map((m) => ({ phone: m.phone, success: false, errorCode: "NOT_CONFIGURED" })),
      ),
    );

    const job = await postCriticalGlucose(seed.patientToken, 45);
    await processCriticalAlert({ data: job.data, id: String(job.id) });

    expect(sendSmsBatchMock).toHaveBeenCalledTimes(1);
    expect(captureUnhandledMock).toHaveBeenCalledTimes(1);
  });
});
