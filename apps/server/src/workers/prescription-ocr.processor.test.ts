import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ClaudeVision from "../shared/ai/claude-vision.js";

// ─────────────────────────────────────────────────────────────────────
// vi.hoisted() runs BEFORE any vi.mock factory + before the SUT import,
// so const refs survive Vitest's hoisting of vi.mock() above this
// module's top-level code.
// ─────────────────────────────────────────────────────────────────────

interface FakeMedicinePhoto {
  id: string;
  photoUrl: string;
  uploadedAt: "initial_upload" | "mid_approval_clarification" | "post_schedule_routine_check";
  createdAt: Date;
}

interface FakePrescription {
  id: string;
  userId: string;
  status: "pending_ocr" | "pending_approval" | "partial" | "approved" | "rejected";
  originalPhotoUrls: string[];
  medicinePhotos: FakeMedicinePhoto[];
  approvalRequestedAt: Date | null;
}

const mocks = vi.hoisted(() => ({
  updateMedicinePhoto: vi.fn(),
  createPrescriptionItem: vi.fn(),
  updatePrescription: vi.fn(),
  generateVisionResponse: vi.fn(),
  getFlag: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
  state: { fakePrescription: null as FakePrescription | null },
}));

vi.mock("../shared/database.js", () => ({
  prisma: {
    prescription: {
      findUnique: vi.fn(() => Promise.resolve(mocks.state.fakePrescription)),
      update: mocks.updatePrescription,
    },
    medicinePhoto: { update: mocks.updateMedicinePhoto },
    prescriptionItem: { create: mocks.createPrescriptionItem },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        medicinePhoto: { update: mocks.updateMedicinePhoto },
        prescriptionItem: { create: mocks.createPrescriptionItem },
        prescription: { update: mocks.updatePrescription },
      });
    }),
  },
}));

vi.mock("../shared/flags/index.js", () => ({
  getFlag: mocks.getFlag,
}));

vi.mock("../shared/ai/claude-vision.js", async () => {
  const actual = await vi.importActual<typeof ClaudeVision>("../shared/ai/claude-vision.js");
  return { ...actual, generateVisionResponse: mocks.generateVisionResponse };
});

vi.mock("../shared/analytics/posthog.js", () => ({
  capture: vi.fn(),
}));

// Convenience aliases for the test body.
const { updateMedicinePhoto, createPrescriptionItem, updatePrescription } = mocks;
const generateVisionResponseMock = mocks.generateVisionResponse;
const getFlagMock = mocks.getFlag;

// SUT — import AFTER mocks
import { processPrescriptionOcr, type PrescriptionOcrJob } from "./prescription-ocr.processor.js";
import { capture } from "../shared/analytics/posthog.js";
import type { Job } from "bullmq";

const captureMock = vi.mocked(capture);

const job = (data: Partial<PrescriptionOcrJob> = {}): Job<PrescriptionOcrJob> =>
  ({
    id: "test-job-1",
    data: { prescriptionId: "rx-1", userId: "user-1", requestId: "req-1", ...data },
  }) as Job<PrescriptionOcrJob>;

const mkRx = (overrides: Partial<FakePrescription> = {}): FakePrescription => ({
  id: "rx-1",
  userId: "user-1",
  status: "pending_ocr",
  originalPhotoUrls: ["https://r2.example.com/rx-1/page-0.jpg"],
  medicinePhotos: [],
  approvalRequestedAt: null,
  ...overrides,
});

beforeEach(() => {
  updateMedicinePhoto.mockReset();
  createPrescriptionItem.mockReset();
  // Real Prisma `create` returns the persisted row; the processor reads
  // `.id` to emit the §F.12 need_clarification event. Return distinct ids.
  let itemSeq = 0;
  createPrescriptionItem.mockImplementation(() => Promise.resolve({ id: `item-${++itemSeq}` }));
  updatePrescription.mockReset();
  generateVisionResponseMock.mockReset();
  getFlagMock.mockReset();
  mocks.state.fakePrescription = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processPrescriptionOcr — kill-switch + idempotency", () => {
  it("short-circuits when prescription_ocr_enabled is false", async () => {
    getFlagMock.mockResolvedValueOnce(false);
    await processPrescriptionOcr(job());
    expect(generateVisionResponseMock).not.toHaveBeenCalled();
    expect(updatePrescription).not.toHaveBeenCalled();
  });

  it("idempotent skip when the prescription is no longer in pending_ocr", async () => {
    getFlagMock.mockResolvedValueOnce(true);
    mocks.state.fakePrescription = mkRx({ status: "pending_approval" });
    await processPrescriptionOcr(job());
    expect(generateVisionResponseMock).not.toHaveBeenCalled();
    expect(updatePrescription).not.toHaveBeenCalled();
  });

  it("refuses to process when job userId mismatches the row's userId", async () => {
    getFlagMock.mockResolvedValueOnce(true);
    mocks.state.fakePrescription = mkRx({ userId: "different-user" });
    await processPrescriptionOcr(job({ userId: "user-1" }));
    expect(generateVisionResponseMock).not.toHaveBeenCalled();
    expect(updatePrescription).not.toHaveBeenCalled();
  });

  it("skips quietly when the prescription row no longer exists", async () => {
    getFlagMock.mockResolvedValueOnce(true);
    mocks.state.fakePrescription = null;
    await processPrescriptionOcr(job());
    expect(generateVisionResponseMock).not.toHaveBeenCalled();
  });
});

describe("processPrescriptionOcr — happy path", () => {
  it("creates 1 PrescriptionItem per Pass-A line + transitions prescription to pending_approval", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx();

    // Single page, two prescription lines, no bottle photos.
    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Glycomet 500",
          dosage: "500 mg tab",
          frequency: "twice daily",
          confidence: 0.92,
          alternatives: [],
        },
        {
          name: "Telma 40",
          dosage: "40 mg tab",
          frequency: "once daily",
          confidence: 0.88,
          alternatives: [],
        },
      ],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1500,
        tokensOutput: 80,
        responseLatencyMs: 600,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job());

    expect(createPrescriptionItem).toHaveBeenCalledTimes(2);
    expect(updatePrescription).toHaveBeenCalledOnce();
    const finalUpdate = updatePrescription.mock.calls[0]![0] as {
      data: { status: string; approvalRequestedAt: Date | undefined };
    };
    // 0.92 confidence + no bottle → YELLOW (not GREEN, not need_clarification)
    // → prescription transitions to pending_approval.
    expect(finalUpdate.data.status).toBe("pending_approval");
    expect(finalUpdate.data.approvalRequestedAt).toBeInstanceOf(Date);
  });

  it("flips to 'partial' when at least one item lands in need_clarification", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx();

    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Glycomet 500",
          dosage: "500 mg tab",
          frequency: "twice daily",
          confidence: 0.92,
          alternatives: [],
        },
        {
          name: "??blur??",
          dosage: "",
          frequency: "",
          // <0.60 + no bottle photo → need_clarification
          confidence: 0.4,
          alternatives: [],
        },
      ],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1500,
        tokensOutput: 60,
        responseLatencyMs: 600,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job());

    expect(createPrescriptionItem).toHaveBeenCalledTimes(2);
    expect(updatePrescription).toHaveBeenCalledOnce();
    const finalUpdate = updatePrescription.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(finalUpdate.data.status).toBe("partial");

    // §F.12 — one need_clarification event for the parked (blur) item.
    const clarifEvents = captureMock.mock.calls.filter(
      ([event]) => event === "prescription_need_clarification_item",
    );
    expect(clarifEvents).toHaveLength(1);
    expect(clarifEvents[0]![2]).toMatchObject({ reason: "no_bottle_low_confidence" });
  });

  it("flips to 'partial' with zero items when Vision returns no readable lines (blank prescription)", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx();

    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1200,
        tokensOutput: 12,
        responseLatencyMs: 400,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job());

    expect(createPrescriptionItem).not.toHaveBeenCalled();
    const finalUpdate = updatePrescription.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(finalUpdate.data.status).toBe("partial");
  });

  it("matches a bottle photo to the right prescription line + records the matched photoId on the item", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx({
      medicinePhotos: [
        {
          id: "photo-glycomet",
          photoUrl: "https://r2.example.com/rx-1/bottle-0.jpg",
          uploadedAt: "initial_upload",
          createdAt: new Date(),
        },
      ],
    });

    // Pass A — one prescription line. Use bare brand name (no
    // dosage in the `name` field) so the alias table canonicalises
    // it to `metformin`. Dosage + frequency are separate fields per
    // the Vision contract.
    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Glycomet",
          dosage: "500 mg tab",
          frequency: "twice daily",
          confidence: 0.9,
          alternatives: [],
        },
      ],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1500,
        tokensOutput: 60,
        responseLatencyMs: 600,
        rawText: "",
      },
    });

    // Pass B — bottle photo says "Obimet" which canonicalises to
    // metformin (same canonical key as "Glycomet") → 1.0 score → match.
    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "medicine_bottle",
      bottle: { aiReadName: "Obimet", confidence: 0.88 },
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 900,
        tokensOutput: 30,
        responseLatencyMs: 500,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job());

    expect(updateMedicinePhoto).toHaveBeenCalledOnce();
    const photoUpdate = updateMedicinePhoto.mock.calls[0]![0] as {
      where: { id: string };
      data: { aiReadName: string; matchStatus: string };
    };
    expect(photoUpdate.where.id).toBe("photo-glycomet");
    expect(photoUpdate.data.matchStatus).toBe("match");

    expect(createPrescriptionItem).toHaveBeenCalledOnce();
    const itemCreate = createPrescriptionItem.mock.calls[0]![0] as {
      data: {
        ocrColor: string;
        pairedMedicinePhotoIds: string[];
        ocrConfidence: number;
      };
    };
    expect(itemCreate.data.ocrColor).toBe("green");
    expect(itemCreate.data.pairedMedicinePhotoIds).toEqual(["photo-glycomet"]);
    // Pass A confidence 0.9 + match boost 0.1 → 1.0
    expect(itemCreate.data.ocrConfidence).toBe(1);
  });

  it("emits aiSuggestionHistory with both Pass A + Pass B audit entries when matched", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx({
      medicinePhotos: [
        {
          id: "photo-glycomet",
          photoUrl: "https://r2.example.com/rx-1/bottle-0.jpg",
          uploadedAt: "initial_upload",
          createdAt: new Date(),
        },
      ],
    });

    generateVisionResponseMock
      .mockResolvedValueOnce({
        mode: "prescription_text",
        lines: [
          {
            name: "Glycomet",
            dosage: "500 mg",
            frequency: "BD",
            confidence: 0.9,
            alternatives: [{ name: "Glycomet GP", confidence: 0.1 }],
          },
        ],
        meta: {
          model: "claude-sonnet-4-6",
          tokensInput: 1500,
          tokensOutput: 60,
          responseLatencyMs: 600,
          rawText: "",
        },
      })
      .mockResolvedValueOnce({
        mode: "medicine_bottle",
        bottle: { aiReadName: "Glycomet", confidence: 0.9 },
        meta: {
          model: "claude-sonnet-4-6",
          tokensInput: 900,
          tokensOutput: 30,
          responseLatencyMs: 500,
          rawText: "",
        },
      });

    await processPrescriptionOcr(job());

    const itemCreate = createPrescriptionItem.mock.calls[0]![0] as {
      data: { aiSuggestionHistory: { source: string }[] };
    };
    const sources = itemCreate.data.aiSuggestionHistory.map((e) => e.source);
    expect(sources).toContain("vision_pass_a");
    expect(sources).toContain("vision_pass_b");
  });

  it("ignores clarification + post-schedule photos in Pass B (they have their own workers)", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx({
      medicinePhotos: [
        {
          id: "photo-routine",
          photoUrl: "url-routine",
          uploadedAt: "post_schedule_routine_check",
          createdAt: new Date(),
        },
        {
          id: "photo-clarify",
          photoUrl: "url-clarify",
          uploadedAt: "mid_approval_clarification",
          createdAt: new Date(),
        },
      ],
    });

    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Glycomet",
          dosage: "",
          frequency: "",
          confidence: 0.9,
          alternatives: [],
        },
      ],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1000,
        tokensOutput: 30,
        responseLatencyMs: 500,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job());

    // Only ONE Vision call total — Pass A. No Pass B calls because no
    // `initial_upload` bottles exist.
    expect(generateVisionResponseMock).toHaveBeenCalledOnce();
    expect(updateMedicinePhoto).not.toHaveBeenCalled();
  });
});

describe("processPrescriptionOcr — PII guard", () => {
  it("sends an anonymised patient id (not the raw userId) into the Vision wrapper", async () => {
    getFlagMock.mockResolvedValue(true);
    mocks.state.fakePrescription = mkRx({ userId: "user-pii-1" });

    generateVisionResponseMock.mockResolvedValueOnce({
      mode: "prescription_text",
      lines: [
        {
          name: "Glycomet",
          dosage: "",
          frequency: "",
          confidence: 0.9,
          alternatives: [],
        },
      ],
      meta: {
        model: "claude-sonnet-4-6",
        tokensInput: 1000,
        tokensOutput: 30,
        responseLatencyMs: 500,
        rawText: "",
      },
    });

    await processPrescriptionOcr(job({ userId: "user-pii-1" }));

    const callArg = generateVisionResponseMock.mock.calls[0]![0] as {
      context: { anonymizedPatientId: string };
      userId: string;
    };
    expect(callArg.context.anonymizedPatientId).toMatch(/^anon_[a-f0-9]{16}$/);
    expect(callArg.context.anonymizedPatientId).not.toContain("user-pii-1");
    // userId still passed for server-side telemetry, NEVER into the context block.
    expect(callArg.userId).toBe("user-pii-1");
  });
});
