-- Household.tier + Household.member_limit — billing/cap moves to the
-- household. CLAUDE.md "Phase 4 Invariants > Tier Downgrade
-- Data-Retention Rule" assumes the household is the unit of billing;
-- per-User tier never made that match reality on a shared phone.
--
-- Strategy:
--   1. Add tier (default free) + member_limit (default 1) — safe on
--      `households` regardless of size since both columns carry
--      defaults.
--   2. Backfill tier: copy from the household's primary user. PR 1
--      established `primary_user_id` as the canonical primary; we lean
--      on it here. Households whose primary_user_id is somehow NULL
--      (shouldn't exist after the PR 1 backfill, but defensively
--      possible) keep the default `free` tier — admin can promote
--      manually if needed.
--   3. Derive member_limit from the freshly-backfilled tier. These
--      caps are the agreed product numbers:
--        free    = 1   (solo patient, no shared phone)
--        premium = 4   (nuclear family: patient + spouse + 2 kids)
--        family  = 10  (extended Indian family)
--   4. Index tier so admin tier-distribution / billing reports stay
--      cheap as the table grows.
--
-- User.tier is intentionally NOT dropped here. The reading code is
-- migrated to household.tier in the same PR, but a follow-up
-- migration drops the column one prod cycle later, matching how PR 1
-- left `households.primary_user_id` nullable for safety.

ALTER TABLE "households" ADD COLUMN "tier" "Tier" NOT NULL DEFAULT 'free';
ALTER TABLE "households" ADD COLUMN "member_limit" INTEGER NOT NULL DEFAULT 1;

UPDATE "households" h
SET "tier" = u."tier"
FROM "users" u
WHERE u."id" = h."primary_user_id";

UPDATE "households"
SET "member_limit" = CASE
  WHEN "tier" = 'free'    THEN 1
  WHEN "tier" = 'premium' THEN 4
  WHEN "tier" = 'family'  THEN 10
END;

CREATE INDEX "households_tier_idx" ON "households"("tier");
