import { reconcilePassAB } from "../prescription-paired-reconciliation/reconciliation.js";
import { nameSimilarity } from "../prescription-paired-reconciliation/similarity.js";
import type {
  PassBCandidate,
  ReconciledItem,
} from "../prescription-paired-reconciliation/types.js";
import type {
  DeltaPromotion,
  DeltaReconciliationInput,
  DeltaReconciliationOutput,
  ExistingItemRef,
} from "./types.js";

/**
 * A new prescription line at or above this similarity to an existing
 * item is treated as the SAME drug and dropped — the item is already
 * in the list. Mirrors the `MATCH_HIGH_THRESHOLD` the paired reconciler
 * uses for "match". Keeping it equal means a re-uploaded identical page
 * never spawns a twin.
 */
const DUPLICATE_THRESHOLD = 0.8;

/**
 * A new bottle photo at or above this similarity to an existing single-
 * source item promotes that item to GREEN. Same bar as a "match" in the
 * initial paired reconciliation — we never promote on a weak signal.
 */
const PROMOTE_THRESHOLD = 0.8;

/**
 * Confidence written onto a promoted item. The clarification worker
 * boosts a matched bottle to 0.92; we use the same value so a YELLOW
 * single-source item (typ. 0.6–0.85) crosses the 0.85 GREEN bar once a
 * bottle corroborates it.
 */
const PROMOTE_CONFIDENCE = 0.92;

const bestExistingSimilarity = (
  name: string,
  existing: readonly ExistingItemRef[],
): { ref: ExistingItemRef; score: number } | null => {
  let best: { ref: ExistingItemRef; score: number } | null = null;
  for (const ref of existing) {
    const score = nameSimilarity(name, ref.aiReadName);
    if (best === null || score > best.score) best = { ref, score };
  }
  return best;
};

const bestBottleFor = (
  name: string,
  passB: readonly PassBCandidate[],
): { candidate: PassBCandidate; score: number } | null => {
  let best: { candidate: PassBCandidate; score: number } | null = null;
  for (const candidate of passB) {
    const score = nameSimilarity(name, candidate.aiReadName);
    if (best === null || score > best.score) best = { candidate, score };
  }
  return best;
};

/**
 * Pure reconciliation of an INCREMENTAL upload (the F.10b "guardian adds
 * what the patient missed" flow) against a prescription that already has
 * items. Distinct from `reconcilePassAB`, which assumes a blank slate.
 *
 * Three jobs, in order:
 *
 *   1. **De-dup new prescription lines.** Each `newPassA` candidate is
 *      compared to every existing item; if it matches one at or above
 *      `DUPLICATE_THRESHOLD` it is dropped (the drug is already in the
 *      list). Its id lands in `droppedDuplicatePassAIds` for audit.
 *
 *   2. **Reconcile the survivors as genuinely-new items.** The kept
 *      `newPassA` candidates run through the standard `reconcilePassAB`
 *      against `newPassB`, producing `newItems` exactly as the initial
 *      OCR would have — same colours, same matched-photo snapshots.
 *
 *   3. **Promote existing single-source items.** Every existing item
 *      with `hasPairedMedicinePhoto === false` looks for a `newPassB`
 *      bottle that matches it at or above `PROMOTE_THRESHOLD`. A hit
 *      yields a `DeltaPromotion` binding that bottle and lifting the
 *      item's confidence into the GREEN band. One bottle may both back
 *      a new item AND promote an existing one — bottles are evidence,
 *      not exclusive, matching the paired reconciler's "one bottle, many
 *      items" rule.
 *
 * **Convergence (property-tested):** applying the same delta a second
 * time produces zero new items and zero promotions. Re-run, every
 * `newPassA` line now matches the item created on the first pass (→
 * dropped), and every previously-promoted item now reports
 * `hasPairedMedicinePhoto === true` (→ not a promotion target). The
 * output therefore cannot grow without bound — the guardian can append
 * the same photo set repeatedly and the list stays stable.
 *
 * Pure: no I/O, no `Date.now()`, no `Math.random`. Deterministic for a
 * given input — safe to call in the `PRESCRIPTION_OCR_DELTA` worker and
 * in tests.
 */
export const reconcileDelta = (input: DeltaReconciliationInput): DeltaReconciliationOutput => {
  // ── 1. Split new Pass-A into duplicates vs genuinely new ───────────
  const droppedDuplicatePassAIds: string[] = [];
  const survivors = input.newPassA.filter((a) => {
    const best = bestExistingSimilarity(a.aiReadName, input.existingItems);
    if (best !== null && best.score >= DUPLICATE_THRESHOLD) {
      droppedDuplicatePassAIds.push(a.id);
      return false;
    }
    return true;
  });

  // ── 2. Reconcile survivors as new items (reuse the paired reconciler) ─
  const newItems: readonly ReconciledItem[] =
    survivors.length > 0 ? reconcilePassAB({ passA: survivors, passB: input.newPassB }).items : [];

  // ── 3. Promote existing single-source items a new bottle corroborates ─
  const promotions: DeltaPromotion[] = [];
  for (const ref of input.existingItems) {
    if (ref.hasPairedMedicinePhoto) continue; // already corroborated — never a target
    const best = bestBottleFor(ref.aiReadName, input.newPassB);
    if (best !== null && best.score >= PROMOTE_THRESHOLD) {
      promotions.push({
        existingItemId: ref.id,
        matchedMedicinePhotoId: best.candidate.medicinePhotoId,
        reconciledConfidence: PROMOTE_CONFIDENCE,
        bestPassBScore: best.score,
      });
    }
  }

  return { newItems, promotions, droppedDuplicatePassAIds };
};
