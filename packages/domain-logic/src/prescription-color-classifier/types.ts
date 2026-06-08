import type { MedicineMatchStatus, PrescriptionItemColor } from "@swasth/shared-types";

/**
 * Input for `classifyPrescriptionItem`. All three fields are required
 * — callers MUST resolve the cross-check status before calling. When
 * no bottle photo was provided, pass `"not_attempted"` + `false`.
 */
export interface PrescriptionItemClassificationInput {
  /**
   * OCR confidence on the prescription text (Pass A). Clamped to
   * `[0, 1]` by the caller; the classifier does NOT renormalise so a
   * pathological value would be caught at the service boundary.
   */
  ocrConfidence: number;
  /**
   * Reconciliation status between this prescription line (Pass A) and
   * any paired medicine-bottle photo (Pass B). Stable across
   * clarification passes — re-running OCR rewrites this column from
   * the new Vision output.
   */
  photoCrossCheckStatus: MedicineMatchStatus;
  /**
   * True when the upload included at least one paired bottle photo.
   * Distinct from `photoCrossCheckStatus === "not_attempted"`: a photo
   * can be provided but yield `unclear` Pass-B output.
   */
  hasPairedMedicinePhoto: boolean;
}

/**
 * Stable reason codes from the classifier. The mobile / server layers
 * map these to i18n copy; never use them as user-visible text.
 */
export type PrescriptionItemClassificationReason =
  | "photo_mismatch"
  | "no_bottle_low_confidence"
  | "low_confidence_with_bottle"
  | "yellow_band"
  | "yellow_no_bottle_high_conf"
  | "yellow_high_conf_unclear_match"
  | "green_match";

export interface PrescriptionItemClassification {
  color: PrescriptionItemColor;
  reason: PrescriptionItemClassificationReason;
}
