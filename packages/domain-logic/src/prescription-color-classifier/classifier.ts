import { PRESCRIPTION_CONFIDENCE_HIGH, PRESCRIPTION_CONFIDENCE_LOW } from "@swasth/shared-types";
import type {
  PrescriptionItemClassification,
  PrescriptionItemClassificationInput,
} from "./types.js";

/**
 * Pure 5-way classifier for a single prescription item. Output drives
 * the mobile approve-banner color and the friction level the approver
 * sees before they can tap Approve.
 *
 * Decision precedence (first match wins):
 *
 *   1. `photoCrossCheckStatus === "mismatch"` → RED.
 *      Overrides confidence — if the bottle in the cabinet says
 *      something different from the prescription line, the AI's
 *      confidence in the prescription line is irrelevant.
 *
 *   2. `ocrConfidence < 0.60`:
 *      a. `hasPairedMedicinePhoto === false` → NEED_CLARIFICATION.
 *         AI couldn't read the line AND we have no second source.
 *         Park the item until the approver supplies a bottle photo
 *         or types the name.
 *      b. else (a bottle photo exists) → RED.
 *         AI read the line poorly but a bottle photo was attempted;
 *         the approver must type-correct AND re-confirm against the
 *         bottle photo before approve.
 *
 *   3. `0.60 ≤ ocrConfidence < 0.85` → YELLOW.
 *      Mid-confidence band — always YELLOW regardless of bottle
 *      status (the bottle can only PROMOTE to green at high
 *      confidence; it never downgrades mid-band).
 *
 *   4. `ocrConfidence ≥ 0.85`:
 *      a. `photoCrossCheckStatus === "match"` → GREEN.
 *         Both sources agree at high confidence. Still requires the
 *         explicit Approve tap, but the banner is green and the
 *         friction is one-tap.
 *      b. else → YELLOW.
 *         High confidence but no second-source corroboration. Per
 *         phase4.md §F.6 GREEN is unreachable without a bottle
 *         match. Covers `not_attempted`, `unclear`, and the
 *         defensive `mismatch` case (already handled at step 1, but
 *         the branch stays correct under future refactors).
 *
 * Pure — no I/O, no `Date.now()`, no Math.random. Deterministic for a
 * given input shape; safe to call in the BullMQ worker, the HTTP
 * request path, and the mobile pre-confirmation preview.
 */
export const classifyPrescriptionItem = (
  input: PrescriptionItemClassificationInput,
): PrescriptionItemClassification => {
  if (input.photoCrossCheckStatus === "mismatch") {
    return { color: "red", reason: "photo_mismatch" };
  }

  if (input.ocrConfidence < PRESCRIPTION_CONFIDENCE_LOW) {
    if (!input.hasPairedMedicinePhoto) {
      return { color: "need_clarification", reason: "no_bottle_low_confidence" };
    }
    return { color: "red", reason: "low_confidence_with_bottle" };
  }

  if (input.ocrConfidence < PRESCRIPTION_CONFIDENCE_HIGH) {
    return { color: "yellow", reason: "yellow_band" };
  }

  if (input.photoCrossCheckStatus === "match") {
    return { color: "green", reason: "green_match" };
  }

  if (input.hasPairedMedicinePhoto) {
    // High confidence + a bottle photo exists but Pass B produced
    // `unclear` (mismatch handled at step 1). Don't promote to green
    // — Pass B's vote was inconclusive, not affirmative.
    return { color: "yellow", reason: "yellow_high_conf_unclear_match" };
  }
  return { color: "yellow", reason: "yellow_no_bottle_high_conf" };
};
