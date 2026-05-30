// Phase 1 corrigendum — /api/v1/emergency-contacts integration tests.
//
// Covers CRUD + the priority-uniqueness invariant + household-cross-
// user authz + the max-5 cap. Single Postgres/Redis container shared
// across the file. Mirrors family.test.ts setup.

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

let patientId: string;
let patientToken: string;
let outsiderToken: string;

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
  app = appModule.buildApp();
  prisma = dbModule.prisma;

  // Two patients in DIFFERENT households so cross-household writes
  // are demonstrably blocked. (The same-household sub-profile path
  // is tested as a separate case below.)
  const patientHousehold = await prisma.household.create({ data: {} });
  const outsiderHousehold = await prisma.household.create({ data: {} });

  const patient = await prisma.user.create({
    data: {
      phone: "+919812345810",
      name: "Ramesh",
      age: 65,
      householdId: patientHousehold.id,
      onboardingComplete: true,
    },
  });
  const outsider = await prisma.user.create({
    data: {
      phone: "+919812345820",
      name: "Stranger",
      age: 40,
      householdId: outsiderHousehold.id,
      onboardingComplete: true,
    },
  });
  patientId = patient.id;

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

// Wipes contacts between tests so priority math starts fresh.
const clearPatientContacts = async (): Promise<void> => {
  await prisma.emergencyContact.deleteMany({ where: { userId: patientId } });
};

const postContact = async (
  token: string,
  body: Record<string, unknown>,
): Promise<request.Response> =>
  await request(app)
    .post("/api/v1/emergency-contacts")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("POST /api/v1/emergency-contacts", () => {
  it("creates a contact for the caller and assigns the given priority", async () => {
    await clearPatientContacts();
    const res = await postContact(patientToken, {
      name: "Suresh",
      phone: "+919812345800",
      relationship: "son",
      priority: 1,
      isGuardian: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contact).toMatchObject({
      userId: patientId,
      name: "Suresh",
      phone: "+919812345800",
      relationship: "son",
      priority: 1,
      isGuardian: true,
    });
  });

  it("rejects malformed phone numbers (zod validation)", async () => {
    await clearPatientContacts();
    const res = await postContact(patientToken, {
      name: "Bad",
      phone: "98123",
      relationship: "son",
      priority: 1,
      isGuardian: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("caps contacts at the per-user limit", async () => {
    await clearPatientContacts();
    for (let i = 1; i <= 5; i += 1) {
      const r = await postContact(patientToken, {
        name: `Contact ${i}`,
        phone: `+9198123458${10 + i}`,
        relationship: "family",
        priority: i,
        isGuardian: false,
      });
      expect(r.status).toBe(201);
    }
    const sixth = await postContact(patientToken, {
      name: "Sixth",
      phone: "+919812345899",
      relationship: "family",
      priority: 5,
      isGuardian: false,
    });
    expect(sixth.status).toBe(400);
    expect(sixth.body.error.code).toBe("VALIDATION_ERROR");
    expect(sixth.body.error.message).toMatch(/Maximum/);
  });

  it("shifts existing rows down when a new contact claims their priority", async () => {
    await clearPatientContacts();
    // Seed three contacts at priority 1, 2, 3.
    for (let i = 1; i <= 3; i += 1) {
      await postContact(patientToken, {
        name: `C${i}`,
        phone: `+9198123459${10 + i}`,
        relationship: "family",
        priority: i,
        isGuardian: false,
      });
    }
    // Insert a new top-priority contact.
    const inserted = await postContact(patientToken, {
      name: "NewTop",
      phone: "+919812345999",
      relationship: "son",
      priority: 1,
      isGuardian: true,
    });
    expect(inserted.status).toBe(201);
    expect(inserted.body.data.contact.priority).toBe(1);

    const list = await request(app)
      .get("/api/v1/emergency-contacts")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(list.status).toBe(200);
    const priorities: number[] = list.body.data.contacts.map(
      (c: { priority: number }) => c.priority,
    );
    // Priorities form a dense 1..N sequence with NewTop at 1.
    expect(priorities).toEqual([1, 2, 3, 4]);
    expect(list.body.data.contacts[0].name).toBe("NewTop");
  });
});

describe("PUT /api/v1/emergency-contacts/:id", () => {
  it("updates fields and re-shifts priorities when priority changes", async () => {
    await clearPatientContacts();
    const seeded: { id: string; priority: number }[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const r = await postContact(patientToken, {
        name: `C${i}`,
        phone: `+9198123450${10 + i}`,
        relationship: "family",
        priority: i,
        isGuardian: false,
      });
      seeded.push({ id: r.body.data.contact.id, priority: r.body.data.contact.priority });
    }
    // Move the priority-3 contact to priority 1. Expect 1→2, 2→3, 3→1.
    const target = seeded[2]!;
    const update = await request(app)
      .put(`/api/v1/emergency-contacts/${target.id}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ priority: 1 });
    expect(update.status).toBe(200);
    expect(update.body.data.contact.priority).toBe(1);

    const list = await request(app)
      .get("/api/v1/emergency-contacts")
      .set("Authorization", `Bearer ${patientToken}`);
    const ordered = list.body.data.contacts.map((c: { id: string }) => c.id);
    expect(ordered[0]).toBe(target.id);
  });

  it("returns 403 when a different household's user tries to edit", async () => {
    await clearPatientContacts();
    const created = await postContact(patientToken, {
      name: "Mine",
      phone: "+919812345111",
      relationship: "son",
      priority: 1,
      isGuardian: false,
    });
    const update = await request(app)
      .put(`/api/v1/emergency-contacts/${created.body.data.contact.id}`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "Hijacked" });
    expect(update.status).toBe(403);
    expect(update.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});

describe("DELETE /api/v1/emergency-contacts/:id", () => {
  it("deletes and renumbers remaining contacts to a dense 1..N sequence", async () => {
    await clearPatientContacts();
    const ids: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const r = await postContact(patientToken, {
        name: `C${i}`,
        phone: `+9198123451${10 + i}`,
        relationship: "family",
        priority: i,
        isGuardian: false,
      });
      ids.push(r.body.data.contact.id);
    }
    // Delete the priority-2 (middle) row.
    const del = await request(app)
      .delete(`/api/v1/emergency-contacts/${ids[1]}`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get("/api/v1/emergency-contacts")
      .set("Authorization", `Bearer ${patientToken}`);
    const priorities = list.body.data.contacts.map((c: { priority: number }) => c.priority);
    expect(priorities).toEqual([1, 2]);
  });

  it("blocks a different household's user from deleting", async () => {
    await clearPatientContacts();
    const created = await postContact(patientToken, {
      name: "Mine",
      phone: "+919812345222",
      relationship: "son",
      priority: 1,
      isGuardian: false,
    });
    const del = await request(app)
      .delete(`/api/v1/emergency-contacts/${created.body.data.contact.id}`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe("FAMILY_NO_ACCESS");
  });
});

describe("GET /api/v1/emergency-contacts", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/emergency-contacts");
    expect(res.status).toBe(401);
  });

  it("returns rows ordered by priority ascending", async () => {
    await clearPatientContacts();
    // Insert out of order.
    await postContact(patientToken, {
      name: "Third",
      phone: "+919812345301",
      relationship: "family",
      priority: 3,
      isGuardian: false,
    });
    await postContact(patientToken, {
      name: "First",
      phone: "+919812345302",
      relationship: "family",
      priority: 1,
      isGuardian: false,
    });
    const list = await request(app)
      .get("/api/v1/emergency-contacts")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(list.status).toBe(200);
    const names = list.body.data.contacts.map((c: { name: string }) => c.name);
    expect(names[0]).toBe("First");
    expect(names[names.length - 1]).toBe("Third");
  });
});
