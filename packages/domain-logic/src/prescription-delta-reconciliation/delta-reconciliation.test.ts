import { describe, expect, it } from "vitest";

import { reconcileDelta } from "./delta-reconciliation.js";
import type { ExistingItemRef } from "./types.js";
import type {
  PassACandidate,
  PassBCandidate,
} from "../prescription-paired-reconciliation/types.js";

const existing = (overrides: Partial<ExistingItemRef> = {}): ExistingItemRef => ({
  id: "item-1",
  aiReadName: "Glycomet",
  hasPairedMedicinePhoto: false,
  ...overrides,
});

const a = (overrides: Partial<PassACandidate> = {}): PassACandidate => ({
  id: "a-1",
  aiReadName: "Telma",
  confidence: 0.9,
  ...overrides,
});

const b = (overrides: Partial<PassBCandidate> = {}): PassBCandidate => ({
  medicinePhotoId: "photo-1",
  aiReadName: "Glycomet",
  confidence: 0.9,
  ...overrides,
});

describe("reconcileDelta — new prescription page introduces a new drug", () => {
  it("creates a new item for a Pass-A line that matches no existing item", () => {
    const out = reconcileDelta({
      existingItems: [existing({ id: "item-1", aiReadName: "Glycomet" })],
      newPassA: [a({ id: "a-new", aiReadName: "Telmisartan 40", confidence: 0.9 })],
      newPassB: [],
    });
    expect(out.newItems).toHaveLength(1);
    expect(out.newItems[0]!.passACandidateId).toBe("a-new");
    expect(out.promotions).toHaveLength(0);
    expect(out.droppedDuplicatePassAIds).toHaveLength(0);
  });
});

describe("reconcileDelta — re-OCR of an already-present line", () => {
  it("drops a new Pass-A line that duplicates an existing item", () => {
    const out = reconcileDelta({
      existingItems: [existing({ id: "item-1", aiReadName: "Glycomet" })],
      newPassA: [a({ id: "a-dup", aiReadName: "Glycomet" })],
      newPassB: [],
    });
    expect(out.newItems).toHaveLength(0);
    expect(out.droppedDuplicatePassAIds).toEqual(["a-dup"]);
  });
});

describe("reconcileDelta — new bottle photo for an existing single-source item", () => {
  it("promotes a YELLOW single-source item when a new bottle matches", () => {
    const out = reconcileDelta({
      existingItems: [
        existing({ id: "item-1", aiReadName: "Glycomet", hasPairedMedicinePhoto: false }),
      ],
      newPassA: [],
      newPassB: [b({ medicinePhotoId: "photo-9", aiReadName: "Glycomet" })],
    });
    expect(out.promotions).toHaveLength(1);
    expect(out.promotions[0]).toMatchObject({
      existingItemId: "item-1",
      matchedMedicinePhotoId: "photo-9",
    });
    expect(out.promotions[0]!.reconciledConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it("does NOT promote an item that already has a paired photo", () => {
    const out = reconcileDelta({
      existingItems: [
        existing({ id: "item-1", aiReadName: "Glycomet", hasPairedMedicinePhoto: true }),
      ],
      newPassA: [],
      newPassB: [b({ aiReadName: "Glycomet" })],
    });
    expect(out.promotions).toHaveLength(0);
  });

  it("does NOT promote when the new bottle is a different drug", () => {
    const out = reconcileDelta({
      existingItems: [existing({ id: "item-1", aiReadName: "Glycomet" })],
      newPassA: [],
      newPassB: [b({ aiReadName: "Telma" })],
    });
    expect(out.promotions).toHaveLength(0);
  });
});

describe("reconcileDelta — combined append (new page + new bottle)", () => {
  it("creates the new item AND promotes a separate existing item in one pass", () => {
    const out = reconcileDelta({
      existingItems: [existing({ id: "item-1", aiReadName: "Glycomet" })],
      newPassA: [a({ id: "a-new", aiReadName: "Amlodipine 5", confidence: 0.9 })],
      newPassB: [b({ medicinePhotoId: "photo-g", aiReadName: "Glycomet" })],
    });
    expect(out.newItems).toHaveLength(1);
    expect(out.newItems[0]!.passACandidateId).toBe("a-new");
    expect(out.promotions).toHaveLength(1);
    expect(out.promotions[0]!.existingItemId).toBe("item-1");
  });
});

describe("reconcileDelta — empty delta", () => {
  it("returns nothing when no new photos are supplied", () => {
    const out = reconcileDelta({
      existingItems: [existing()],
      newPassA: [],
      newPassB: [],
    });
    expect(out.newItems).toHaveLength(0);
    expect(out.promotions).toHaveLength(0);
    expect(out.droppedDuplicatePassAIds).toHaveLength(0);
  });
});
