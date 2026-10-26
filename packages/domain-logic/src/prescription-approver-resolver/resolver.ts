import { relationshipFamily } from "./relationship.js";
import type {
  AcceptedFamilyLink,
  ApproverResolution,
  ApproverResolverInput,
  RelationshipFamily,
} from "./types.js";

/**
 * Family-precedence order for approver selection. When the patient
 * has guardians spanning multiple families, child wins over spouse
 * wins over caregiver per phase4.md §F.2 "lowest priority or child
 * first".
 */
const APPROVER_FAMILY_ORDER: readonly Extract<
  RelationshipFamily,
  "child" | "spouse" | "caregiver"
>[] = ["child", "spouse", "caregiver"];

interface CandidateLink {
  link: AcceptedFamilyLink;
  family: Extract<RelationshipFamily, "child" | "spouse" | "caregiver">;
}

/**
 * Pure resolver for "who approves this prescription?" per the table
 * in phase4.md §F.2 and CLAUDE.md "Approval authority: guardian-
 * primary". Encodes three branches:
 *
 *   1. **Guardian primary** — patient has ≥ 1 accepted FamilyLink
 *      whose relationship folds to `child | spouse | caregiver`.
 *      Approver is that guardian; friction is `"none"`. Tie-break by
 *      family (child > spouse > caregiver) then by acceptance time
 *      (earliest wins — stable "primary" identity over invite
 *      churn).
 *
 *   2. **Self capable adult** — no guardian in the approver families,
 *      but the patient acts as a guardian elsewhere. Implies
 *      capacity. Self-approval allowed with `"none"` friction.
 *
 *   3. **Solo with friction** — no qualifying guardian and the
 *      patient is not a guardian elsewhere. The elderly-shared-
 *      device case CLAUDE.md "Solo patient (no guardian)" targets.
 *      Self-approval allowed but `"high"` friction (3-second
 *      activation delay + re-confirm modal).
 *
 * Pure — no I/O, no `Date.now()`, no `Math.random`. Deterministic
 * for a given input shape. SAFETY-CRITICAL: the approver decision
 * gates whether the wrong medication can land in a 70-year-old's
 * medicine cabinet. 100% branch coverage is enforced.
 */
export const resolveApprover = (input: ApproverResolverInput): ApproverResolution => {
  const candidates: CandidateLink[] = [];
  for (const link of input.acceptedFamilyLinks) {
    const family = relationshipFamily(link.relationship);
    if (family === "child" || family === "spouse" || family === "caregiver") {
      candidates.push({ link, family });
    }
  }

  if (candidates.length > 0) {
    const primary = pickPrimaryGuardian(candidates);
    return {
      approverUserId: primary.link.guardianId,
      requiresGuardianApproval: true,
      frictionLevel: "none",
      reason:
        primary.family === "child"
          ? "guardian_primary_child"
          : primary.family === "spouse"
            ? "guardian_primary_spouse"
            : "guardian_primary_caregiver",
    };
  }

  if (input.patientIsGuardianElsewhere) {
    return {
      approverUserId: input.patientUserId,
      requiresGuardianApproval: false,
      frictionLevel: "none",
      reason: "self_capable_adult",
    };
  }

  return {
    approverUserId: input.patientUserId,
    requiresGuardianApproval: false,
    frictionLevel: "high",
    reason: "self_solo_with_friction",
  };
};

const pickPrimaryGuardian = (candidates: readonly CandidateLink[]): CandidateLink => {
  // 1. Sort by family precedence.
  // 2. Within the same family, earliest acceptance wins.
  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    if (compareCandidate(c, best) < 0) best = c;
  }
  return best;
};

const compareCandidate = (a: CandidateLink, b: CandidateLink): number => {
  const ai = APPROVER_FAMILY_ORDER.indexOf(a.family);
  const bi = APPROVER_FAMILY_ORDER.indexOf(b.family);
  if (ai !== bi) return ai - bi;
  // Same family — stable ordering by ISO acceptedAt (lexicographic
  // sort on ISO is equivalent to chronological sort).
  if (a.link.acceptedAt < b.link.acceptedAt) return -1;
  if (a.link.acceptedAt > b.link.acceptedAt) return 1;
  return 0;
};

/**
 * Approval authority for an EXISTING prescription. Pure.
 *
 * `frozenRequiresGuardianApproval` is `Prescription.requiresGuardianApproval`,
 * resolved at upload and immutable afterwards. The live resolution may move
 * authority toward a guardian (a newly linked guardian, or a different
 * guardian after churn) but never back to the patient: a patient who revokes
 * their guardian must not be able to self-approve a prescription the
 * guardian was meant to check (audit P6). Returns `null` when nobody may
 * approve until a guardian is linked again — the patient can still upload a
 * fresh prescription, which resolves authority anew.
 */
export const resolveEffectiveApprover = (
  frozenRequiresGuardianApproval: boolean,
  live: ApproverResolution,
): ApproverResolution | null =>
  frozenRequiresGuardianApproval && !live.requiresGuardianApproval ? null : live;
