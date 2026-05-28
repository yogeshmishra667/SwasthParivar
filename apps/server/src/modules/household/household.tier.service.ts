import { DomainError } from "@swasth/shared-types";
import type { Tier } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { MEMBER_LIMIT_BY_TIER } from "../../shared/billing/tier-caps.js";

/**
 * `setHouseholdTier` — the canonical mutation for changing a
 * household's tier. Two callers:
 *
 *   1. Admin tier change (`PUT /admin/users/:id/tier`) — kept
 *      `actor.kind = "admin"`. The admin controller wraps this call
 *      with an `AdminAuditLog` row (`household.tier_changed`).
 *   2. Payment webhook (Phase 4 Razorpay/IAP) — `actor.kind =
 *      "webhook"`. The webhook controller wraps this call with a
 *      `PaymentEvent` row carrying the verified payload.
 *
 * Either way the service guarantees:
 *   - Tier + memberLimit move atomically (Prisma transaction).
 *   - Cap policy is sourced from `MEMBER_LIMIT_BY_TIER` — one source of
 *     truth shared with `addHouseholdProfile` and the backfill SQL.
 *   - Downgrade NEVER deletes profiles. If the household is now over
 *     the new cap, we log + emit a `household.over_cap` warning so ops
 *     can investigate, but the rows stay (matches CLAUDE.md "Phase 4
 *     Invariants > Tier Downgrade Data-Retention Rule").
 *   - The mutation is idempotent: re-applying the same tier returns
 *     `previousTier === tier` with no DB write.
 *
 * Audit + observability are the caller's responsibility — this service
 * does not write to AdminAuditLog directly because the audit FK
 * (`admin_user_id`) is admin-only. Webhook auditing happens via
 * PaymentEvent in the Phase 4 ship.
 */
export type SetHouseholdTierActor =
  | { kind: "admin"; adminUserId: string }
  | { kind: "webhook"; provider: "razorpay" | "iap"; eventId: string };

export interface SetHouseholdTierInput {
  householdId: string;
  tier: Tier;
  actor: SetHouseholdTierActor;
}

export interface SetHouseholdTierResult {
  householdId: string;
  previousTier: Tier;
  previousMemberLimit: number;
  tier: Tier;
  memberLimit: number;
  /**
   * Current number of users in the household. If > new `memberLimit`,
   * the caller should surface a warning — but no rows were deleted.
   */
  memberCount: number;
  overCap: boolean;
}

export const setHouseholdTier = async (
  input: SetHouseholdTierInput,
): Promise<SetHouseholdTierResult> => {
  const targetMemberLimit = MEMBER_LIMIT_BY_TIER[input.tier];

  return await prisma.$transaction(async (tx) => {
    const household = await tx.household.findUnique({
      where: { id: input.householdId },
      select: { tier: true, memberLimit: true },
    });
    if (!household) {
      throw new DomainError("HOUSEHOLD_NOT_FOUND", "household not found");
    }

    const memberCount = await tx.user.count({ where: { householdId: input.householdId } });
    const previousTier = household.tier;
    const previousMemberLimit = household.memberLimit;

    if (previousTier === input.tier && previousMemberLimit === targetMemberLimit) {
      // Idempotent re-apply. Skip the write so audit logs from the
      // caller stay meaningful (only real changes get an audit row).
      return {
        householdId: input.householdId,
        previousTier,
        previousMemberLimit,
        tier: input.tier,
        memberLimit: targetMemberLimit,
        memberCount,
        overCap: memberCount > targetMemberLimit,
      };
    }

    await tx.household.update({
      where: { id: input.householdId },
      data: { tier: input.tier, memberLimit: targetMemberLimit },
    });

    const overCap = memberCount > targetMemberLimit;
    if (overCap) {
      // Downgrade left the household over its new cap. Per CLAUDE.md
      // we never delete profiles — surface a structured warning instead
      // so ops can follow up via the admin console. The caller is
      // responsible for the corresponding PostHog event (it owns the
      // analytics context, e.g. admin vs webhook).
      logger.warn(
        {
          householdId: input.householdId,
          previousTier,
          tier: input.tier,
          memberLimit: targetMemberLimit,
          memberCount,
          actorKind: input.actor.kind,
        },
        "household tier change left household over cap (no profiles deleted)",
      );
    }

    return {
      householdId: input.householdId,
      previousTier,
      previousMemberLimit,
      tier: input.tier,
      memberLimit: targetMemberLimit,
      memberCount,
      overCap,
    };
  });
};
