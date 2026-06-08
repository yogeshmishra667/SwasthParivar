import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { classifyPrescriptionItem } from "./classifier.js";
import type { PrescriptionItemClassificationInput } from "./types.js";

const input = (overrides: Partial<PrescriptionItemClassificationInput> = {}) =>
  ({
    ocrConfidence: 0.9,
    photoCrossCheckStatus: "match",
    hasPairedMedicinePhoto: true,
    ...overrides,
  }) satisfies PrescriptionItemClassificationInput;

describe("classifyPrescriptionItem", () => {
  describe("photo mismatch overrides everything", () => {
    it("RED when bottle photo mismatches, even at perfect confidence", () => {
      expect(
        classifyPrescriptionItem(input({ ocrConfidence: 1.0, photoCrossCheckStatus: "mismatch" })),
      ).toEqual({ color: "red", reason: "photo_mismatch" });
    });

    it("RED when bottle photo mismatches, even at low confidence", () => {
      expect(
        classifyPrescriptionItem(input({ ocrConfidence: 0.2, photoCrossCheckStatus: "mismatch" })),
      ).toEqual({ color: "red", reason: "photo_mismatch" });
    });
  });

  describe("low confidence (< 0.60)", () => {
    it("NEED_CLARIFICATION when no bottle photo was uploaded", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.4,
            photoCrossCheckStatus: "not_attempted",
            hasPairedMedicinePhoto: false,
          }),
        ),
      ).toEqual({ color: "need_clarification", reason: "no_bottle_low_confidence" });
    });

    it("RED when a bottle photo exists but OCR confidence is low", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.5,
            photoCrossCheckStatus: "unclear",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "red", reason: "low_confidence_with_bottle" });
    });

    it("RED at confidence = 0.5999... (just under the 0.60 boundary) with a bottle", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.5999,
            photoCrossCheckStatus: "match",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "red", reason: "low_confidence_with_bottle" });
    });
  });

  describe("mid confidence (0.60 ≤ x < 0.85) — YELLOW band", () => {
    it("YELLOW at lower boundary (0.60)", () => {
      expect(classifyPrescriptionItem(input({ ocrConfidence: 0.6 }))).toEqual({
        color: "yellow",
        reason: "yellow_band",
      });
    });

    it("YELLOW at upper boundary (0.8499)", () => {
      expect(classifyPrescriptionItem(input({ ocrConfidence: 0.8499 }))).toEqual({
        color: "yellow",
        reason: "yellow_band",
      });
    });

    it("YELLOW in the middle of the band, with or without a bottle match", () => {
      expect(
        classifyPrescriptionItem(input({ ocrConfidence: 0.7, photoCrossCheckStatus: "match" }))
          .color,
      ).toBe("yellow");
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.7,
            photoCrossCheckStatus: "not_attempted",
            hasPairedMedicinePhoto: false,
          }),
        ).color,
      ).toBe("yellow");
    });
  });

  describe("high confidence (≥ 0.85)", () => {
    it("GREEN when bottle photo matches", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.9,
            photoCrossCheckStatus: "match",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "green", reason: "green_match" });
    });

    it("GREEN at boundary 0.85 with match", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.85,
            photoCrossCheckStatus: "match",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "green", reason: "green_match" });
    });

    it("YELLOW (not green) when no bottle photo was uploaded", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.95,
            photoCrossCheckStatus: "not_attempted",
            hasPairedMedicinePhoto: false,
          }),
        ),
      ).toEqual({ color: "yellow", reason: "yellow_no_bottle_high_conf" });
    });

    it("YELLOW when bottle photo exists but Pass B produced 'unclear'", () => {
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.95,
            photoCrossCheckStatus: "unclear",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "yellow", reason: "yellow_high_conf_unclear_match" });
    });

    it("YELLOW when status is 'not_attempted' but the flag wrongly says a photo exists (defensive)", () => {
      // Real callers shouldn't combine these, but the branch must
      // still produce a safe (non-green) result.
      expect(
        classifyPrescriptionItem(
          input({
            ocrConfidence: 0.99,
            photoCrossCheckStatus: "not_attempted",
            hasPairedMedicinePhoto: true,
          }),
        ),
      ).toEqual({ color: "yellow", reason: "yellow_high_conf_unclear_match" });
    });
  });

  describe("property — every input lands in exactly one of four colors", () => {
    it("classifier is total: no input combination produces undefined", () => {
      fc.assert(
        fc.property(
          fc.double({
            min: 0,
            max: 1,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          fc.constantFrom(...(["match", "mismatch", "unclear", "not_attempted"] as const)),
          fc.boolean(),
          (ocrConfidence, status, hasPhoto) => {
            const result = classifyPrescriptionItem({
              ocrConfidence,
              photoCrossCheckStatus: status,
              hasPairedMedicinePhoto: hasPhoto,
            });
            expect(["red", "yellow", "green", "need_clarification"]).toContain(result.color);
            expect(result.reason).toBeTypeOf("string");
          },
        ),
      );
    });

    it("GREEN requires status === 'match' AND confidence ≥ 0.85", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.constantFrom(...(["match", "mismatch", "unclear", "not_attempted"] as const)),
          fc.boolean(),
          (ocrConfidence, status, hasPhoto) => {
            const result = classifyPrescriptionItem({
              ocrConfidence,
              photoCrossCheckStatus: status,
              hasPairedMedicinePhoto: hasPhoto,
            });
            if (result.color === "green") {
              expect(status).toBe("match");
              expect(ocrConfidence).toBeGreaterThanOrEqual(0.85);
            }
          },
        ),
      );
    });

    it("mismatch ALWAYS produces RED", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.boolean(),
          (ocrConfidence, hasPhoto) => {
            const result = classifyPrescriptionItem({
              ocrConfidence,
              photoCrossCheckStatus: "mismatch",
              hasPairedMedicinePhoto: hasPhoto,
            });
            expect(result.color).toBe("red");
            expect(result.reason).toBe("photo_mismatch");
          },
        ),
      );
    });
  });
});
