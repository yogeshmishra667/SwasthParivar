import { describe, expect, it } from "vitest";

import { reconcilePassAB } from "./reconciliation.js";
import type { PassACandidate, PassBCandidate } from "./types.js";

const a = (overrides: Partial<PassACandidate> = {}): PassACandidate => ({
  id: "a-1",
  aiReadName: "Glycomet",
  confidence: 0.7,
  ...overrides,
});

const b = (overrides: Partial<PassBCandidate> = {}): PassBCandidate => ({
  medicinePhotoId: "photo-1",
  aiReadName: "Glycomet",
  confidence: 0.9,
  ...overrides,
});

describe("reconcilePassAB — Pass B is empty (no bottle photos)", () => {
  it("marks every item as not_attempted with unchanged confidence", () => {
    const result = reconcilePassAB({
      passA: [
        a({ id: "a-1", aiReadName: "Glycomet", confidence: 0.7 }),
        a({ id: "a-2", aiReadName: "Telma", confidence: 0.8 }),
      ],
      passB: [],
    });
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.photoCrossCheckStatus).toBe("not_attempted");
      expect(item.matchedMedicinePhotoId).toBeNull();
      expect(item.bestPassBScore).toBe(0);
    }
    expect(result.items[0]!.reconciledConfidence).toBe(0.7);
    expect(result.items[1]!.reconciledConfidence).toBe(0.8);
  });
});

describe("reconcilePassAB — match band (score ≥ 0.80)", () => {
  it("matches Pass A to Pass B when names canonicalise to the same alias", () => {
    const result = reconcilePassAB({
      passA: [a({ aiReadName: "Glycomet", confidence: 0.7 })],
      // "obimet" is in the alias table under metformin → score 1.0
      passB: [b({ medicinePhotoId: "photo-1", aiReadName: "Obimet" })],
    });
    expect(result.items[0]).toMatchObject({
      photoCrossCheckStatus: "match",
      matchedMedicinePhotoId: "photo-1",
    });
    expect(result.items[0]!.bestPassBScore).toBe(1);
    // Confidence boosted by 0.1, clamped to 1.0.
    expect(result.items[0]!.reconciledConfidence).toBeCloseTo(0.8, 5);
  });

  it("clamps boosted confidence at 1.0", () => {
    const result = reconcilePassAB({
      passA: [a({ confidence: 0.95 })],
      passB: [b({ aiReadName: "Glycomet" })],
    });
    expect(result.items[0]!.reconciledConfidence).toBe(1);
  });

  it("picks the highest-scoring Pass B candidate when multiple bottles match", () => {
    const result = reconcilePassAB({
      passA: [a({ aiReadName: "Glycomet" })],
      passB: [
        b({ medicinePhotoId: "photo-1", aiReadName: "glycornet" }), // OCR typo → ~0.88
        b({ medicinePhotoId: "photo-2", aiReadName: "Obimet" }), // alias → 1.0
        b({ medicinePhotoId: "photo-3", aiReadName: "Telma" }), // different drug → 0.05
      ],
    });
    expect(result.items[0]!.matchedMedicinePhotoId).toBe("photo-2");
    expect(result.items[0]!.photoCrossCheckStatus).toBe("match");
  });
});

describe("reconcilePassAB — mismatch band (LOOSE ≤ score < MATCH_HIGH)", () => {
  it("marks 'Glycomet 500' vs 'Glycomet GP 1' as mismatch (same stem, different variant)", () => {
    const result = reconcilePassAB({
      passA: [a({ aiReadName: "Glycomet 500", confidence: 0.7 })],
      passB: [b({ aiReadName: "Glycomet GP 1" })],
    });
    expect(result.items[0]).toMatchObject({
      photoCrossCheckStatus: "mismatch",
      matchedMedicinePhotoId: null,
      reconciledConfidence: 0.7, // unchanged
    });
    expect(result.items[0]!.bestPassBScore).toBeGreaterThan(0.4);
    expect(result.items[0]!.bestPassBScore).toBeLessThan(0.8);
  });
});

describe("reconcilePassAB — not-attempted when Pass B exists but is unrelated", () => {
  it("marks an item as not_attempted when no Pass B candidate has meaningful overlap", () => {
    const result = reconcilePassAB({
      // Only one Pass A item, but the bottle uploaded is for a totally
      // different drug → alias-table short-circuits to 0.05 → below
      // LOOSE threshold → not_attempted (bottles weren't for this item).
      passA: [a({ aiReadName: "Glycomet", confidence: 0.7 })],
      passB: [b({ medicinePhotoId: "photo-1", aiReadName: "Telma" })],
    });
    expect(result.items[0]).toMatchObject({
      photoCrossCheckStatus: "not_attempted",
      matchedMedicinePhotoId: null,
      reconciledConfidence: 0.7,
    });
  });
});

describe("reconcilePassAB — multi-item prescriptions", () => {
  it("handles a 3-item prescription where 2 bottles match different items", () => {
    const result = reconcilePassAB({
      passA: [
        a({ id: "a-glycomet", aiReadName: "Glycomet", confidence: 0.8 }),
        a({ id: "a-telma", aiReadName: "Telma", confidence: 0.9 }),
        a({ id: "a-atorva", aiReadName: "Atorva", confidence: 0.75 }),
      ],
      passB: [
        b({ medicinePhotoId: "photo-glycomet", aiReadName: "Glyciphage" }),
        b({ medicinePhotoId: "photo-telma", aiReadName: "Telday" }),
        // No bottle for atorvastatin → that item should be not_attempted
      ],
    });

    expect(result.items[0]).toMatchObject({
      passACandidateId: "a-glycomet",
      photoCrossCheckStatus: "match",
      matchedMedicinePhotoId: "photo-glycomet",
    });
    expect(result.items[1]).toMatchObject({
      passACandidateId: "a-telma",
      photoCrossCheckStatus: "match",
      matchedMedicinePhotoId: "photo-telma",
    });
    expect(result.items[2]).toMatchObject({
      passACandidateId: "a-atorva",
      photoCrossCheckStatus: "not_attempted",
      matchedMedicinePhotoId: null,
    });
  });

  it("permits one bottle to match multiple Pass A items (e.g. morning + evening doses of same drug)", () => {
    const result = reconcilePassAB({
      passA: [a({ id: "a-am", aiReadName: "Glycomet" }), a({ id: "a-pm", aiReadName: "Glycomet" })],
      passB: [b({ medicinePhotoId: "photo-1", aiReadName: "Glycomet" })],
    });
    expect(result.items[0]!.photoCrossCheckStatus).toBe("match");
    expect(result.items[1]!.photoCrossCheckStatus).toBe("match");
    expect(result.items[0]!.matchedMedicinePhotoId).toBe("photo-1");
    expect(result.items[1]!.matchedMedicinePhotoId).toBe("photo-1");
  });
});

describe("reconcilePassAB — edge cases", () => {
  it("handles an empty Pass A (no prescription items extracted)", () => {
    const result = reconcilePassAB({
      passA: [],
      passB: [b({ aiReadName: "Glycomet" })],
    });
    expect(result.items).toEqual([]);
  });

  it("preserves the Pass A id verbatim in the output", () => {
    const result = reconcilePassAB({
      passA: [a({ id: "page-2:row-7" })],
      passB: [],
    });
    expect(result.items[0]!.passACandidateId).toBe("page-2:row-7");
  });
});
