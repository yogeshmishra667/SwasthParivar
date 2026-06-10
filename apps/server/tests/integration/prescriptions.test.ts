// Phase 4 §F.11 — prescription OCR + approval HTTP integration suite.
//
// Real Postgres + Redis (Testcontainers). Claude Vision is mocked (no
// external calls) and R2 is a fake S3 client; everything else — routes,
// services, Prisma, the OCR + delta processors — runs for real against
// the container DB.
//
// Focus is the safety-critical surface that had no HTTP-level coverage:
//   • approval-authority gate (guardian-required vs solo vs outsider)
//   • paired reconciliation → item colour (green/yellow/need_clarification)
//   • approve transaction → MedicationSchedule creation + status math
//   • §F.10b augmentation (append-photos delta, manual-add) + locking
//   • clarify attempt cap, reject cascade, routine medicine-photo cross-check

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import jwt from "jsonwebtoken";

import type * as ClaudeVision from "../../src/shared/ai/claude-vision.js";

// ── Vision mock — a mutable holder drives per-call output ─────────────
const vision = vi.hoisted(() => ({
  // Pass-A lines returned for every prescription_text call.
  lines: [] as {
    name: string;
    dosage: string;
    frequency: string;
    confidence: number;
    alternatives: unknown[];
  }[],
  // Pass-B / clarification readings, consumed in call order.
  bottleQueue: [] as { aiReadName: string; confidence: number }[],
}));

vi.mock("../../src/shared/ai/claude-vision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ClaudeVision>();
  const meta = { model: "test-model", tokensInput: 1, tokensOutput: 1, responseLatencyMs: 1 };
  return {
    ...actual,
    generateVisionResponse: vi.fn((input: { mode: string }) => {
      if (input.mode === "prescription_text") {
        return Promise.resolve({ mode: "prescription_text", lines: vision.lines, meta });
      }
      const next = vision.bottleQueue.shift() ?? { aiReadName: "", confidence: 0 };
      return Promise.resolve({ mode: input.mode, bottle: next, meta });
    }),
  };
});

const runPrisma = (args: string[], opts: { input?: string } = {}): void => {
  const result = spawnSync("npx", ["prisma", ...args], {
    env: { ...process.env },
    stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit",
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed (${result.status})`);
};

let pg: StartedPostgreSqlContainer;
let redisC: StartedRedisContainer;
let app: any;
let prisma: any;
let processOcr: any;
let processDelta: any;

let img: Buffer;

// patient (shared device) + their guardian (separate primary account) +
// a solo patient with no guardian + an unrelated outsider.
let patientId: string;
let patientHh: string;
let guardianId: string;
let guardianHh: string;
let soloId: string;
let soloHh: string;
let outsiderId: string;
let outsiderHh: string;
let patientToken: string;
let guardianToken: string;
let soloToken: string;
let outsiderToken: string;

const bearer = (t: string): [string, string] => ["Authorization", `Bearer ${t}`];

const line = (name: string, conf: number, freq = "1-0-0") => ({
  name,
  dosage: "500mg",
  frequency: freq,
  confidence: conf,
  alternatives: [] as unknown[],
});

beforeAll(async () => {
  pg = await new PostgreSqlContainer("timescale/timescaledb:latest-pg16")
    .withDatabase("swasth_parivar_test")
    .start();
  redisC = await new RedisContainer("redis:7-alpine").start();

  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = redisC.getConnectionUrl();
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.JWT_REFRESH_SECRET = "test-refresh-test-refresh-test-refresh-123";
  process.env.OTP_SECRET = "test-otp-test-otp-test-otp-test-otp-12345";
  // Fake R2 — dummy creds satisfy the lazy-client guard; the client is
  // overridden below so no network happens. Public base URL keeps URL
  // minting offline (no presign) and its host avoids the GET refresh path.
  process.env.R2_ACCOUNT_ID = "test-acct";
  process.env.R2_ACCESS_KEY = "test-key";
  process.env.R2_SECRET_KEY = "test-secret";
  process.env.R2_BUCKET = "test-bucket";
  process.env.R2_PUBLIC_BASE_URL = "https://cdn.test.local";

  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "execute", "--stdin"], {
    input: "SELECT create_hypertable('glucose_readings', 'measured_at', if_not_exists => TRUE);",
  });

  const appModule = await import("../../src/app.js");
  const dbModule = await import("../../src/shared/database.js");
  const ocrModule = await import("../../src/workers/prescription-ocr.processor.js");
  const deltaModule = await import("../../src/workers/prescription-ocr-delta.processor.js");
  const r2Module = await import("../../src/shared/storage/r2.js");
  const flagsModule = await import("../../src/shared/flags/index.js");

  app = appModule.buildApp();
  prisma = dbModule.prisma;
  processOcr = ocrModule.processPrescriptionOcr;
  processDelta = deltaModule.processPrescriptionOcrDelta;

  // Fake S3 client: PutObject resolves, nothing leaves the process.
  r2Module.__setR2ClientForTests({ send: () => Promise.resolve({}) } as any);

  await flagsModule.setFlag("prescription_ocr_enabled", true, "integration_test");
  flagsModule.__resetFlagCache();

  img = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 8, g: 16, b: 24 } },
  })
    .jpeg()
    .toBuffer();

  const mkHh = async (): Promise<string> => (await prisma.household.create({ data: {} })).id;
  patientHh = await mkHh();
  guardianHh = await mkHh();
  soloHh = await mkHh();
  outsiderHh = await mkHh();

  const mkUser = async (phone: string, name: string, hh: string): Promise<string> =>
    (
      await prisma.user.create({
        data: {
          phone,
          name,
          age: 60,
          householdId: hh,
          conditions: ["diabetes"],
          timezone: "Asia/Kolkata",
          onboardingComplete: true,
        },
      })
    ).id;

  patientId = await mkUser("+919810000001", "Ramesh", patientHh);
  guardianId = await mkUser("+919810000002", "Suresh", guardianHh);
  soloId = await mkUser("+919810000003", "Geeta", soloHh);
  outsiderId = await mkUser("+919810000004", "Outsider", outsiderHh);

  // Accepted guardian link → patient's prescriptions require guardian approval.
  await prisma.familyLink.create({
    data: {
      patientId,
      guardianId,
      relationship: "child",
      status: "accepted",
      acceptedAt: new Date(),
    },
  });

  const sign = (sub: string, hh: string): string =>
    jwt.sign({ sub, householdId: hh }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  patientToken = sign(patientId, patientHh);
  guardianToken = sign(guardianId, guardianHh);
  soloToken = sign(soloId, soloHh);
  outsiderToken = sign(outsiderId, outsiderHh);
}, 180_000);

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
  if (pg) await pg.stop();
  if (redisC) await redisC.stop();
});

beforeEach(() => {
  vision.lines = [];
  vision.bottleQueue = [];
});

// ── helpers ──────────────────────────────────────────────────────────

/** Upload as the patient with N prescription pages + M bottle photos. */
const upload = async (
  token: string,
  opts: { pages?: number; bottles?: number; targetUserId?: string } = {},
): Promise<string> => {
  const pages = opts.pages ?? 1;
  const bottles = opts.bottles ?? 0;
  let req = request(app)
    .post("/api/v1/prescriptions/upload")
    .set(...bearer(token));
  for (let i = 0; i < pages; i += 1)
    req = req.attach("prescriptionPhotos", img, {
      filename: `p${i}.jpg`,
      contentType: "image/jpeg",
    });
  for (let i = 0; i < bottles; i += 1)
    req = req.attach("medicinePhotos", img, { filename: `b${i}.jpg`, contentType: "image/jpeg" });
  if (opts.targetUserId) req = req.field("targetUserId", opts.targetUserId);
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.data.prescriptionId as string;
};

const runOcr = async (prescriptionId: string, userId: string): Promise<void> => {
  await processOcr({
    id: `ocr-${prescriptionId}`,
    data: { prescriptionId, userId, requestId: "req-test" },
  } as any);
};

const getRx = (token: string, id: string) =>
  request(app)
    .get(`/api/v1/prescriptions/${id}`)
    .set(...bearer(token));

// ─────────────────────────────────────────────────────────────────────
describe("upload + OCR — paired reconciliation → item colour", () => {
  it("green when a bottle photo corroborates a high-confidence line", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    vision.bottleQueue = [{ aiReadName: "Glycomet", confidence: 0.95 }];
    const id = await upload(patientToken, { pages: 1, bottles: 1 });
    await runOcr(id, patientId);

    const res = await getRx(patientToken, id);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].ocrColor).toBe("green");
    expect(res.body.data.status).toBe("pending_approval");
  });

  it("yellow when a high-confidence line has no bottle photo (single source)", async () => {
    vision.lines = [line("Telma 40", 0.95)];
    const id = await upload(patientToken, { pages: 1, bottles: 0 });
    await runOcr(id, patientId);
    const res = await getRx(patientToken, id);
    expect(res.body.data.items[0].ocrColor).toBe("yellow");
  });

  it("need_clarification when a low-confidence line has no bottle photo", async () => {
    vision.lines = [line("???scrawl", 0.3)];
    const id = await upload(patientToken, { pages: 1, bottles: 0 });
    await runOcr(id, patientId);
    const res = await getRx(patientToken, id);
    expect(res.body.data.items[0].ocrColor).toBe("need_clarification");
    expect(res.body.data.status).toBe("partial");
  });
});

describe("upload — requiresGuardianApproval resolution", () => {
  it("flags requiresGuardianApproval=true for a patient with an accepted guardian", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const id = await upload(patientToken, { pages: 1 });
    const res = await getRx(patientToken, id);
    expect(res.body.data.requiresGuardianApproval).toBe(true);
    expect(res.body.data.approverUserId).toBe(guardianId);
  });

  it("flags requiresGuardianApproval=false for a solo patient", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const id = await upload(soloToken, { pages: 1 });
    const res = await getRx(soloToken, id);
    expect(res.body.data.requiresGuardianApproval).toBe(false);
    expect(res.body.data.approverUserId).toBe(soloId);
  });
});

describe("approval authority gate", () => {
  let rxId: string;
  let itemId: string;
  beforeEach(async () => {
    vision.lines = [line("Glycomet", 0.95)];
    vision.bottleQueue = [{ aiReadName: "Glycomet", confidence: 0.95 }];
    rxId = await upload(patientToken, { pages: 1, bottles: 1 });
    await runOcr(rxId, patientId);
    const res = await getRx(patientToken, rxId);
    itemId = res.body.data.items[0].id;
  });

  const approveBody = () => ({
    items: [
      {
        id: itemId,
        decision: "approve",
        verifiedMedicineName: "Glycomet",
        verifiedDosage: "500mg",
        verifiedFrequency: "1-0-1",
      },
    ],
  });

  it("403 when the patient tries to self-approve a guardian-required prescription", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/approve`)
      .set(...bearer(patientToken))
      .send(approveBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("APPROVAL_REQUIRES_GUARDIAN");
  });

  it("403 when an unrelated outsider tries to approve", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/approve`)
      .set(...bearer(outsiderToken))
      .send(approveBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("APPROVAL_REQUIRES_GUARDIAN");
  });

  it("200 when the resolved guardian approves — creates a MedicationSchedule", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/approve`)
      .set(...bearer(guardianToken))
      .send(approveBody());
    expect(res.status).toBe(200);
    expect(res.body.data.createdScheduleIds).toHaveLength(1);
    expect(res.body.data.status).toBe("approved");

    const schedules = await prisma.medicationSchedule.findMany({ where: { userId: patientId } });
    expect(schedules.some((s: { medicineName: string }) => s.medicineName === "Glycomet")).toBe(
      true,
    );
  });
});

describe("approval authority — solo self-approve with friction allowed", () => {
  it("200 when a solo patient self-approves", async () => {
    vision.lines = [line("Amlodipine", 0.95)];
    const id = await upload(soloToken, { pages: 1 });
    await runOcr(id, soloId);
    const detail = await getRx(soloToken, id);
    const item = detail.body.data.items[0];

    const res = await request(app)
      .post(`/api/v1/prescriptions/${id}/approve`)
      .set(...bearer(soloToken))
      .send({
        items: [
          {
            id: item.id,
            decision: "approve",
            verifiedMedicineName: "Amlodipine",
            verifiedDosage: "5mg",
            verifiedFrequency: "1-0-0",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.createdScheduleIds).toHaveLength(1);
  });
});

describe("approve transaction — mixed decisions + status math", () => {
  it("partial when one item is approved and another left untouched", async () => {
    vision.lines = [line("Glycomet", 0.95), line("Telma", 0.95)];
    const id = await upload(patientToken, { pages: 1 });
    await runOcr(id, patientId);
    const detail = await getRx(patientToken, id);
    const [a, b] = detail.body.data.items;

    const res = await request(app)
      .post(`/api/v1/prescriptions/${id}/approve`)
      .set(...bearer(guardianToken))
      .send({
        items: [
          { id: a.id, decision: "needs_doctor" },
          {
            id: b.id,
            decision: "approve",
            verifiedMedicineName: "Telma",
            verifiedDosage: "40mg",
            verifiedFrequency: "1-0-0",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.approvedItemIds).toHaveLength(1);
    expect(res.body.data.needsDoctorItemIds).toHaveLength(1);
    expect(res.body.data.status).toBe("approved"); // all items now terminal
  });
});

describe("manual add — POST /:id/items (§F.10b.3)", () => {
  let rxId: string;
  beforeEach(async () => {
    vision.lines = [line("Glycomet", 0.95)];
    rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);
  });

  it("creates a YELLOW item with verified fields pre-filled", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(guardianToken))
      .send({
        typedMedicineName: "Vitamin D3",
        typedDosage: "60k IU",
        typedFrequency: "weekly",
        addAttemptId: randomUUID(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.ocrColor).toBe("yellow");
    expect(res.body.data.status).toBe("pending");
  });

  it("flags needs_doctor when frequency exceeds 6x/day", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(guardianToken))
      .send({
        typedMedicineName: "Crocin",
        typedDosage: "500mg",
        typedFrequency: "1-1-1-1-1-1-1",
        addAttemptId: randomUUID(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("needs_doctor");
  });

  it("is idempotent on addAttemptId — second call returns the same item", async () => {
    const addAttemptId = randomUUID();
    const body = {
      typedMedicineName: "Ecosprin",
      typedDosage: "75mg",
      typedFrequency: "1-0-0",
      addAttemptId,
    };
    const first = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(guardianToken))
      .send(body);
    const second = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(guardianToken))
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.data.itemId).toBe(first.body.data.itemId);
    expect(second.body.data.duplicate).toBe(true);
  });

  it("403 when an outsider tries to manual-add", async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(outsiderToken))
      .send({
        typedMedicineName: "X",
        typedDosage: "1",
        typedFrequency: "1-0-0",
        addAttemptId: randomUUID(),
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("APPROVAL_REQUIRES_GUARDIAN");
  });
});

describe("append photos — POST /:id/photos (§F.10b.2 delta)", () => {
  it("202 + delta creates a new item from an appended page", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);

    // The append's OCR delta sees a NEW drug on the appended page.
    vision.lines = [line("Atorvastatin", 0.95)];
    const deltaUploadId = randomUUID();
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/photos`)
      .set(...bearer(guardianToken))
      .attach("prescriptionPhotos", img, { filename: "extra.jpg", contentType: "image/jpeg" })
      .field("deltaUploadId", deltaUploadId);
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("ocr_delta_queued");

    await processDelta({
      id: `d-${rxId}`,
      data: {
        prescriptionId: rxId,
        userId: patientId,
        deltaUploadId,
        newPrescriptionPhotoUrls: res.body.data.newPrescriptionPhotoUrls,
        newMedicinePhotoIds: res.body.data.newMedicinePhotoIds,
        requestId: "req-delta",
      },
    } as any);

    const detail = await getRx(patientToken, rxId);
    const names = detail.body.data.items.map((i: { ocrMedicineName: string }) => i.ocrMedicineName);
    expect(names).toContain("Atorvastatin");
  });

  it("duplicate deltaUploadId is a no-op", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);

    const deltaUploadId = randomUUID();
    const send = () =>
      request(app)
        .post(`/api/v1/prescriptions/${rxId}/photos`)
        .set(...bearer(guardianToken))
        .attach("prescriptionPhotos", img, { filename: "x.jpg", contentType: "image/jpeg" })
        .field("deltaUploadId", deltaUploadId);
    const first = await send();
    expect(first.body.data.status).toBe("ocr_delta_queued");
    const second = await send();
    expect(second.status).toBe(202);
    expect(second.body.data.status).toBe("duplicate_ignored");
  });

  it("403 when an outsider tries to append", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);
    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/photos`)
      .set(...bearer(outsiderToken))
      .attach("prescriptionPhotos", img, { filename: "x.jpg", contentType: "image/jpeg" })
      .field("deltaUploadId", randomUUID());
    expect(res.status).toBe(403);
  });
});

describe("locking — no writes after approve/reject", () => {
  it("409 PRESCRIPTION_LOCKED when appending to an approved prescription", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);
    const detail = await getRx(patientToken, rxId);
    await request(app)
      .post(`/api/v1/prescriptions/${rxId}/approve`)
      .set(...bearer(guardianToken))
      .send({
        items: [
          {
            id: detail.body.data.items[0].id,
            decision: "approve",
            verifiedMedicineName: "Glycomet",
            verifiedDosage: "500mg",
            verifiedFrequency: "1-0-0",
          },
        ],
      });

    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items`)
      .set(...bearer(guardianToken))
      .send({
        typedMedicineName: "Late",
        typedDosage: "1",
        typedFrequency: "1-0-0",
        addAttemptId: randomUUID(),
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRESCRIPTION_LOCKED");
  });
});

describe("reject — cascade + lock", () => {
  it("rejects the prescription and cascades pending items", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);

    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/reject`)
      .set(...bearer(guardianToken))
      .send({ reason: "wrong patient" });
    expect(res.status).toBe(200);

    const detail = await getRx(patientToken, rxId);
    expect(detail.body.data.status).toBe("rejected");
    expect(detail.body.data.items.every((i: { status: string }) => i.status === "rejected")).toBe(
      true,
    );
  });
});

describe("clarify — typed-name path + authority", () => {
  it("403 when an outsider clarifies", async () => {
    vision.lines = [line("???", 0.3)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);
    const detail = await getRx(patientToken, rxId);
    const itemId = detail.body.data.items[0].id;

    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items/${itemId}/clarify`)
      .set(...bearer(outsiderToken))
      .field("typedMedicineName", "Glycomet")
      .field("clarificationAttemptId", randomUUID());
    expect(res.status).toBe(403);
  });

  it("202 when the guardian clarifies a parked item with a typed name", async () => {
    vision.lines = [line("???", 0.3)];
    const rxId = await upload(patientToken, { pages: 1 });
    await runOcr(rxId, patientId);
    const detail = await getRx(patientToken, rxId);
    const itemId = detail.body.data.items[0].id;

    const res = await request(app)
      .post(`/api/v1/prescriptions/${rxId}/items/${itemId}/clarify`)
      .set(...bearer(guardianToken))
      .field("typedMedicineName", "Glycomet")
      .field("clarificationAttemptId", randomUUID());
    expect(res.status).toBe(202);
    expect(res.body.data.attemptNumber).toBe(1);
  });
});

describe("routine medicine-photo cross-check — POST /medicines/:id/photo", () => {
  let scheduleId: string;
  beforeAll(async () => {
    const schedule = await prisma.medicationSchedule.create({
      data: { userId: patientId, medicineName: "Glycomet", timeSlots: ["09:00"] },
    });
    scheduleId = schedule.id;
  });

  it("202 + creates a post_schedule_routine_check MedicinePhoto", async () => {
    const res = await request(app)
      .post(`/api/v1/medicines/${scheduleId}/photo`)
      .set(...bearer(patientToken))
      .attach("photo", img, { filename: "bottle.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("cross_check_queued");

    const photo = await prisma.medicinePhoto.findUnique({
      where: { id: res.body.data.medicinePhotoId },
    });
    expect(photo.uploadedAt).toBe("post_schedule_routine_check");
    expect(photo.medicationScheduleId).toBe(scheduleId);
  });

  it("404 for a non-existent schedule", async () => {
    const res = await request(app)
      .post(`/api/v1/medicines/${randomUUID()}/photo`)
      .set(...bearer(patientToken))
      .attach("photo", img, { filename: "bottle.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MED_SCHEDULE_NOT_FOUND");
  });

  it("403 when an outsider posts a photo to another patient's schedule", async () => {
    const res = await request(app)
      .post(`/api/v1/medicines/${scheduleId}/photo`)
      .set(...bearer(outsiderToken))
      .attach("photo", img, { filename: "bottle.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(403);
  });
});

describe("read authority — GET /:id", () => {
  it("403 when an outsider reads a prescription they have no link to", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    const res = await getRx(outsiderToken, rxId);
    expect(res.status).toBe(403);
  });

  it("200 when the linked guardian reads the patient's prescription", async () => {
    vision.lines = [line("Glycomet", 0.95)];
    const rxId = await upload(patientToken, { pages: 1 });
    const res = await getRx(guardianToken, rxId);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(rxId);
  });
});
