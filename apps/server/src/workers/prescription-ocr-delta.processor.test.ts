import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ClaudeVision from "../shared/ai/claude-vision.js";

// ─────────────────────────────────────────────────────────────────────
// Fully-mocked unit test for the PRESCRIPTION_OCR_DELTA processor — same
// hoisted-mock strategy as prescription-ocr.processor.test.ts. The pure
// reconciliation is covered by the domain-logic package; here we assert
// the worker's orchestration: kill-switch, idempotency, new-item create,
// and existing-item promotion.
// ─────────────────────────────────────────────────────────────────────

interface FakeItem {
  id: string;
  ocrMedicineName: string;
  verifiedMedicineName: string | null;
  pairedMedicinePhotoIds: string[];
  status: string;
  aiSuggestionHistory: unknown[];
}

interface FakeRx {
  id: string;
  userId: string;
  status: "pending_ocr" | "pending_approval" | "partial" | "approved" | "rejected";
  ocrRawResult: Record<string, unknown>;
  items: FakeItem[];
}

const mocks = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  updateMedicinePhoto: vi.fn(),
  updatePrescription: vi.fn(),
  findManyMedicinePhoto: vi.fn(),
  findManyItems: vi.fn(),
  generateVisionResponse: vi.fn(),
  getFlag: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
  state: { rx: null as FakeRx | null },
}));

vi.mock("../shared/database.js", () => ({
  prisma: {
    prescription: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          mocks.state.rx ? { ...mocks.state.rx, ocrRawResult: mocks.state.rx.ocrRawResult } : null,
        ),
      ),
    },
    medicinePhoto: { findMany: mocks.findManyMedicinePhoto },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        prescription: {
          findUnique: vi.fn(() =>
            Promise.resolve(mocks.state.rx ? { ocrRawResult: mocks.state.rx.ocrRawResult } : null),
          ),
          update: mocks.updatePrescription,
        },
        medicinePhoto: { update: mocks.updateMedicinePhoto },
        prescriptionItem: {
          create: mocks.createItem,
          update: mocks.updateItem,
          findMany: mocks.findManyItems,
        },
      });
    }),
  },
}));

vi.mock("../shared/flags/index.js", () => ({ getFlag: mocks.getFlag }));

vi.mock("../shared/ai/claude-vision.js", async () => {
  const actual = await vi.importActual<typeof ClaudeVision>("../shared/ai/claude-vision.js");
  return { ...actual, generateVisionResponse: mocks.generateVisionResponse };
});

vi.mock("../shared/analytics/posthog.js", () => ({ capture: vi.fn() }));

import { processPrescriptionOcrDelta } from "./prescription-ocr-delta.processor.js";
import type { PrescriptionOcrDeltaJob } from "../modules/prescriptions/prescriptions.types.js";
import type { Job } from "bullmq";

const job = (data: Partial<PrescriptionOcrDeltaJob> = {}): Job<PrescriptionOcrDeltaJob> =>
  ({
    id: "delta-job-1",
    data: {
      prescriptionId: "rx-1",
      userId: "user-1",
      deltaUploadId: "delta-1",
      newPrescriptionPhotoUrls: [],
      newMedicinePhotoIds: [],
      requestId: "req-1",
      ...data,
    },
  }) as Job<PrescriptionOcrDeltaJob>;

const mkRx = (overrides: Partial<FakeRx> = {}): FakeRx => ({
  id: "rx-1",
  userId: "user-1",
  status: "pending_approval",
  ocrRawResult: {},
  items: [],
  ...overrides,
});

beforeEach(() => {
  for (const m of [
    mocks.createItem,
    mocks.updateItem,
    mocks.updateMedicinePhoto,
    mocks.updatePrescription,
    mocks.findManyMedicinePhoto,
    mocks.findManyItems,
    mocks.generateVisionResponse,
    mocks.getFlag,
  ]) {
    m.mockReset();
  }
  // Real Prisma `create` returns the persisted row; the delta processor
  // reads `.id` to emit the §F.12 need_clarification event.
  let itemSeq = 0;
  mocks.createItem.mockImplementation(() => Promise.resolve({ id: `item-${++itemSeq}` }));
  mocks.findManyMedicinePhoto.mockResolvedValue([]);
  mocks.findManyItems.mockResolvedValue([{ status: "pending" }]);
  mocks.state.rx = null;
});

afterEach(() => vi.restoreAllMocks());

describe("processPrescriptionOcrDelta — guards", () => {
  it("short-circuits when prescription_ocr_enabled is false", async () => {
    mocks.getFlag.mockResolvedValueOnce(false);
    await processPrescriptionOcrDelta(job());
    expect(mocks.generateVisionResponse).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it("idempotent skip when the deltaUploadId is already in appliedDeltas", async () => {
    mocks.getFlag.mockResolvedValue(true);
    mocks.state.rx = mkRx({ ocrRawResult: { appliedDeltas: ["delta-1"] } });
    await processPrescriptionOcrDelta(job({ deltaUploadId: "delta-1" }));
    expect(mocks.generateVisionResponse).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it("refuses when the job userId mismatches the row", async () => {
    mocks.getFlag.mockResolvedValue(true);
    mocks.state.rx = mkRx({ userId: "other-user" });
    await processPrescriptionOcrDelta(job({ userId: "user-1" }));
    expect(mocks.generateVisionResponse).not.toHaveBeenCalled();
  });
});

describe("processPrescriptionOcrDelta — new item from a new page", () => {
  it("creates a PrescriptionItem for a line that matches no existing item", async () => {
    mocks.getFlag.mockResolvedValue(true);
    mocks.state.rx = mkRx({
      items: [
        {
          id: "item-existing",
          ocrMedicineName: "Glycomet",
          verifiedMedicineName: null,
          pairedMedicinePhotoIds: ["photo-old"],
          status: "pending",
          aiSuggestionHistory: [],
        },
      ],
    });
    mocks.generateVisionResponse.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Telmisartan 40",
          dosage: "40mg",
          frequency: "1-0-0",
          confidence: 0.9,
          alternatives: [],
        },
      ],
      meta: { model: "m", tokensInput: 1, tokensOutput: 1, responseLatencyMs: 1 },
    });

    await processPrescriptionOcrDelta(
      job({ newPrescriptionPhotoUrls: ["https://r2/new-page.jpg"] }),
    );

    expect(mocks.createItem).toHaveBeenCalledTimes(1);
    const created = mocks.createItem.mock.calls[0]![0].data;
    expect(created.ocrMedicineName).toBe("Telmisartan 40");
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });
});

describe("processPrescriptionOcrDelta — promotion of a single-source item", () => {
  it("promotes an existing item without a paired photo when a new bottle matches", async () => {
    mocks.getFlag.mockResolvedValue(true);
    mocks.state.rx = mkRx({
      items: [
        {
          id: "item-yellow",
          ocrMedicineName: "Glycomet",
          verifiedMedicineName: null,
          pairedMedicinePhotoIds: [],
          status: "pending",
          aiSuggestionHistory: [],
        },
      ],
    });
    mocks.findManyMedicinePhoto.mockResolvedValue([
      { id: "photo-new", photoUrl: "https://r2/bottle.jpg" },
    ]);
    mocks.generateVisionResponse.mockResolvedValueOnce({
      mode: "medicine_bottle",
      bottle: { aiReadName: "Glycomet", confidence: 0.9 },
      meta: { model: "m", tokensInput: 1, tokensOutput: 1, responseLatencyMs: 1 },
    });

    await processPrescriptionOcrDelta(job({ newMedicinePhotoIds: ["photo-new"] }));

    expect(mocks.updateItem).toHaveBeenCalledTimes(1);
    const update = mocks.updateItem.mock.calls[0]![0];
    expect(update.where.id).toBe("item-yellow");
    expect(update.data.ocrColor).toBe("green");
    expect(update.data.pairedMedicinePhotoIds).toContain("photo-new");
    expect(mocks.createItem).not.toHaveBeenCalled();
  });
});
