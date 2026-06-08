import type { ApproverFrictionLevel } from "@swasth/shared-types";

/**
 * Canonical family of relationships, used INTERNALLY by the resolver
 * to map free-text patient input ("son", "beta", "biwi", "nurse ji")
 * onto a structured precedence order. `other` and `unknown` never
 * qualify as a guardian-primary approver per phase4.md §F.2.
 */
export type RelationshipFamily = "child" | "spouse" | "caregiver" | "other" | "unknown";

/**
 * Minimal slice of an accepted `FamilyLink` row required to resolve
 * the approver. Service layer is responsible for pre-filtering on
 * `status === "accepted"`; passing pending/declined links is a bug.
 */
export interface AcceptedFamilyLink {
  guardianId: string;
  /**
   * Free-text label the patient typed at invite time ("son", "biwi",
   * "Dr Mehta", null). The resolver folds it into a
   * {@link RelationshipFamily} via the aliases table.
   */
  relationship: string | null;
  /**
   * Acceptance timestamp (ISO 8601). Used as the tiebreaker when
   * multiple guardians share the same {@link RelationshipFamily} —
   * earliest accepted wins.
   */
  acceptedAt: string;
}

export interface ApproverResolverInput {
  patientUserId: string;
  /**
   * FamilyLinks where the patient is the PATIENT side, with status
   * `"accepted"`. Service layer pre-filters; this module never
   * touches Prisma.
   */
  acceptedFamilyLinks: readonly AcceptedFamilyLink[];
  /**
   * True when the patient ALSO appears as a guardian on at least one
   * other accepted FamilyLink (they are caring for someone else).
   * Implies adult capacity per phase4.md §F.2 row 3 — solo approval
   * with NO extra friction in that case.
   */
  patientIsGuardianElsewhere: boolean;
}

/**
 * Stable reason codes describing which branch of §F.2 fired. Mapped
 * to PostHog dimensions in the service layer; never user-visible.
 */
export type ApproverResolutionReason =
  | "guardian_primary_child"
  | "guardian_primary_spouse"
  | "guardian_primary_caregiver"
  | "self_capable_adult"
  | "self_solo_with_friction";

export interface ApproverResolution {
  /** Who can hit `/approve`. */
  approverUserId: string;
  /**
   * Snapshot of "does this prescription require a guardian to
   * approve?". Persisted to `Prescription.requiresGuardianApproval`
   * at upload and immutable afterwards (so a guardian being removed
   * mid-approval cannot flip authority back to the elderly patient).
   */
  requiresGuardianApproval: boolean;
  /**
   * `"high"` only for the solo-elderly branch (CLAUDE.md "Solo
   * patient (no guardian)" — 3-second delay + re-confirm modal).
   * Guardian-primary and self-capable-adult flows are `"none"`.
   */
  frictionLevel: ApproverFrictionLevel;
  reason: ApproverResolutionReason;
}
