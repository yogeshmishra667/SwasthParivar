-- Household.primaryUserId — explicit "who is the primary" marker.
--
-- Until now the primary was implicit: the User row in the household
-- whose phone matched the JWT subject. Profile-aware features
-- (guardian gating, tier inheritance, billing scope) need a
-- mechanical answer. This column is the source of truth.
--
-- Strategy:
--   1. Add nullable `primary_user_id` (no default, no FK yet).
--   2. Backfill: per household, set primary = oldest User by created_at.
--      This matches signup reality — the User created at household-
--      creation time is always the primary; sub-profiles are added
--      strictly later via POST /household/profiles.
--   3. A follow-up migration (separate change) makes the column NOT
--      NULL and adds the FK to users(id) once production rows are
--      confirmed populated. Keeping that split avoids a one-shot
--      tight-coupling failure on a stale prod row.
--
-- No FK in this migration: even after backfill, the FK target is
-- another row in `users` which has its own lifecycle. We add the FK
-- in the follow-up to give us a clean rollback window.

ALTER TABLE "households" ADD COLUMN "primary_user_id" UUID;

UPDATE "households" h
SET "primary_user_id" = sub."id"
FROM (
  SELECT DISTINCT ON ("household_id") "id", "household_id"
  FROM "users"
  ORDER BY "household_id", "created_at" ASC
) sub
WHERE h."id" = sub."household_id";
