import type { Tier } from "@prisma/client";

/**
 * Member-cap table by tier — single source of truth shared by:
 *  - the household-profile cap check (POST /household/profiles)
 *  - the setHouseholdTier mutation (so member_limit + tier always
 *    move atomically, no drift between row state and policy)
 *  - the backfill migration's CASE expression (kept in sync by hand —
 *    these numbers are the agreed product caps)
 *
 * If you change a cap, change it here AND add a follow-up migration
 * that updates `households.member_limit` for the affected tier.
 */
export const MEMBER_LIMIT_BY_TIER: Readonly<Record<Tier, number>> = {
  free: 1,
  premium: 4,
  family: 10,
};

/**
 * Suggested upgrade target when a household hits its cap. Used by the
 * mobile "Upgrade for more profiles" CTA copy. `family` has no next
 * tier — callers should treat null as "already at the top".
 */
export const NEXT_TIER: Readonly<Record<Tier, Tier | null>> = {
  free: "premium",
  premium: "family",
  family: null,
};
