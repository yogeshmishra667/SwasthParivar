import type { MedicineMatchStatus } from "@swasth/shared-types";

/**
 * A single OCR Pass-A candidate — one prescription line as Vision read
 * it from one of the prescription pages. Future PrescriptionItem.
 */
export interface PassACandidate {
  /**
   * Stable identifier assigned by the caller (e.g. `${pageIndex}:${row}`).
   * The reconciliation output references this so the service layer
   * can map back to the row that produced each `ReconciledItem`.
   */
  readonly id: string;
  /** Vision's reading of the medicine name from the prescription text. */
  readonly aiReadName: string;
  /** Vision's confidence on the text reading, [0, 1]. */
  readonly confidence: number;
}

/**
 * A single OCR Pass-B candidate — one medicine-bottle photo as Vision
 * read it. The `medicinePhotoId` is the DB row id, used downstream to
 * snapshot `pairedMedicinePhotoIds` on the `PrescriptionItem`.
 */
export interface PassBCandidate {
  readonly medicinePhotoId: string;
  /** Vision's reading of the medicine name from the bottle. */
  readonly aiReadName: string;
  /** Vision's confidence on the bottle reading, [0, 1]. */
  readonly confidence: number;
}

export interface PrescriptionPairedReconciliationInput {
  readonly passA: readonly PassACandidate[];
  readonly passB: readonly PassBCandidate[];
}

/**
 * Result of reconciling one Pass-A candidate against Pass-B. The
 * service layer feeds these into `prescription-color-classifier` along
 * with `hasPairedMedicinePhoto` to produce the final per-item color.
 */
export interface ReconciledItem {
  /** Echoes the input `PassACandidate.id`. */
  readonly passACandidateId: string;
  /** Best name to surface to the approver — the Pass-A reading. */
  readonly aiReadName: string;
  /**
   * Pass A's confidence after Pass-B reconciliation.
   * - `"match"`: boosted (clamped to 1.0).
   * - `"mismatch"` / `"not_attempted"`: unchanged from Pass A.
   */
  readonly reconciledConfidence: number;
  readonly photoCrossCheckStatus: MedicineMatchStatus;
  /**
   * `MedicinePhoto.id` of the best Pass-B match — populated only when
   * `photoCrossCheckStatus === "match"`. Snapshotted onto
   * `PrescriptionItem.pairedMedicinePhotoIds` so the audit trail can
   * replay which bottle photo informed which item.
   */
  readonly matchedMedicinePhotoId: string | null;
  /**
   * Raw similarity score against the best Pass-B candidate, [0, 1].
   * Exposed for telemetry / debugging — service layer doesn't need
   * to act on it directly (the status string already encodes the
   * threshold decision).
   */
  readonly bestPassBScore: number;
}

export interface PrescriptionPairedReconciliationOutput {
  readonly items: readonly ReconciledItem[];
}
