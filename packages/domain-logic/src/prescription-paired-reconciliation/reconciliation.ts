import { nameSimilarity } from "./similarity.js";
import type {
  PassBCandidate,
  PrescriptionPairedReconciliationInput,
  PrescriptionPairedReconciliationOutput,
  ReconciledItem,
} from "./types.js";

/**
 * Score thresholds — calibrated against phase4.md §F.6 + §F.3.
 *
 * - ≥ MATCH_HIGH_THRESHOLD → "match". A clear hit. Pass A and Pass B
 *   are saying the same drug.
 * - [LOOSE_THRESHOLD, MATCH_HIGH_THRESHOLD) → "mismatch". Suspicious
 *   overlap — e.g. "Glycomet 500" vs "Glycomet GP 1" (same stem, but
 *   the variant differs). The classifier downstream will mark this
 *   RED regardless of Pass A confidence.
 * - < LOOSE_THRESHOLD → no relationship to this item. Status becomes
 *   "not_attempted" — bottles were uploaded, just not for this item.
 */
const MATCH_HIGH_THRESHOLD = 0.8;
const LOOSE_THRESHOLD = 0.4;

const CONFIDENCE_MATCH_BOOST = 0.1;

interface BestPassBMatch {
  readonly score: number;
  readonly passB: PassBCandidate;
}

const findBestMatch = (
  aiReadName: string,
  passB: readonly PassBCandidate[],
): BestPassBMatch | null => {
  if (passB.length === 0) return null;
  let best: BestPassBMatch | null = null;
  for (const candidate of passB) {
    const score = nameSimilarity(aiReadName, candidate.aiReadName);
    if (best === null || score > best.score) {
      best = { score, passB: candidate };
    }
  }
  return best;
};

/**
 * Pure reconciliation of OCR Pass A (prescription text) vs Pass B
 * (medicine-bottle photos). For each Pass-A candidate the matcher
 * finds the best Pass-B candidate by name similarity, then maps the
 * result onto one of three `photoCrossCheckStatus` values:
 *
 *   - `"match"` — high similarity. Promotes confidence by 0.1
 *     (clamped). Snapshots the matched `medicinePhotoId`.
 *   - `"mismatch"` — moderate similarity. Pass B is talking about
 *     something close to the prescription line but NOT the same drug
 *     (typical: stem matches, variant/dosage differs). Confidence
 *     unchanged; downstream classifier will mark this RED.
 *   - `"not_attempted"` — no Pass B at all, OR Pass B exists but no
 *     bottle photo speaks for this item. Confidence unchanged.
 *
 * Pure — no I/O, no `Date.now()`, no `Math.random`. Same input always
 * produces the same output. Safe to call in the BullMQ worker (the
 * actual `PRESCRIPTION_OCR` consumer in F.4) and in tests.
 *
 * The matcher allows one Pass B candidate to match MULTIPLE Pass A
 * items — by design. Two prescription lines for the same drug (e.g.
 * morning + evening dose split across two lines) should both
 * legitimately match the same bottle. The downstream items remain
 * distinct because they carry different dosage/frequency text.
 */
export const reconcilePassAB = (
  input: PrescriptionPairedReconciliationInput,
): PrescriptionPairedReconciliationOutput => {
  const items: ReconciledItem[] = [];
  for (const a of input.passA) {
    const best = findBestMatch(a.aiReadName, input.passB);

    if (best === null) {
      items.push({
        passACandidateId: a.id,
        aiReadName: a.aiReadName,
        reconciledConfidence: a.confidence,
        photoCrossCheckStatus: "not_attempted",
        matchedMedicinePhotoId: null,
        bestPassBScore: 0,
      });
      continue;
    }

    if (best.score >= MATCH_HIGH_THRESHOLD) {
      items.push({
        passACandidateId: a.id,
        aiReadName: a.aiReadName,
        reconciledConfidence: Math.min(1, a.confidence + CONFIDENCE_MATCH_BOOST),
        photoCrossCheckStatus: "match",
        matchedMedicinePhotoId: best.passB.medicinePhotoId,
        bestPassBScore: best.score,
      });
      continue;
    }

    if (best.score >= LOOSE_THRESHOLD) {
      items.push({
        passACandidateId: a.id,
        aiReadName: a.aiReadName,
        reconciledConfidence: a.confidence,
        photoCrossCheckStatus: "mismatch",
        matchedMedicinePhotoId: null,
        bestPassBScore: best.score,
      });
      continue;
    }

    // Pass B exists but no candidate has any meaningful relationship
    // to this prescription line — the bottles uploaded were for OTHER
    // items in the prescription.
    items.push({
      passACandidateId: a.id,
      aiReadName: a.aiReadName,
      reconciledConfidence: a.confidence,
      photoCrossCheckStatus: "not_attempted",
      matchedMedicinePhotoId: null,
      bestPassBScore: best.score,
    });
  }
  return { items };
};
