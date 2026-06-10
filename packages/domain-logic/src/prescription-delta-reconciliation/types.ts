import type {
  PassACandidate,
  PassBCandidate,
  ReconciledItem,
} from "../prescription-paired-reconciliation/types.js";

/**
 * A minimal projection of an existing `PrescriptionItem` the delta
 * reconciler needs to reason about — just enough to (a) detect that a
 * newly-OCR'd prescription line duplicates an item already in the list
 * and (b) decide whether a fresh bottle photo can promote a still-
 * single-source item to GREEN.
 */
export interface ExistingItemRef {
  /** `PrescriptionItem.id`. */
  readonly id: string;
  /**
   * Best current name for the item — the approver-verified name when
   * present, else the Pass-A OCR name. Used for similarity matching
   * against both new prescription lines and new bottle photos.
   */
  readonly aiReadName: string;
  /**
   * True when the item already has at least one paired bottle photo.
   * Items that are already corroborated are NEVER promotion targets —
   * this is what guarantees convergence (a re-applied delta finds
   * nothing left to promote).
   */
  readonly hasPairedMedicinePhoto: boolean;
}

export interface DeltaReconciliationInput {
  /** Items already attached to the prescription before this delta. */
  readonly existingItems: readonly ExistingItemRef[];
  /** Pass-A candidates extracted from the NEW prescription pages only. */
  readonly newPassA: readonly PassACandidate[];
  /** Pass-B candidates extracted from the NEW bottle photos only. */
  readonly newPassB: readonly PassBCandidate[];
}

/**
 * Instruction to bind a new bottle photo onto an EXISTING item, lifting
 * it from single-source (YELLOW) to corroborated (GREEN). The service
 * layer re-classifies the item with `hasPairedMedicinePhoto: true` and
 * the boosted `reconciledConfidence`.
 */
export interface DeltaPromotion {
  readonly existingItemId: string;
  readonly matchedMedicinePhotoId: string;
  /**
   * Confidence to write onto the promoted item. Boosted to the GREEN
   * band so the downstream classifier yields `green` (mirrors the
   * clarification worker's match boost).
   */
  readonly reconciledConfidence: number;
  /** Raw similarity score against the matched bottle, for telemetry. */
  readonly bestPassBScore: number;
}

export interface DeltaReconciliationOutput {
  /** Genuinely-new items to create (new Pass-A lines with no existing twin). */
  readonly newItems: readonly ReconciledItem[];
  /** Existing single-source items a new bottle photo now corroborates. */
  readonly promotions: readonly DeltaPromotion[];
  /**
   * Pass-A candidate ids that were dropped because they duplicate an
   * existing item. Surfaced for audit / telemetry — the convergence
   * guarantee depends on these never becoming new items.
   */
  readonly droppedDuplicatePassAIds: readonly string[];
}
