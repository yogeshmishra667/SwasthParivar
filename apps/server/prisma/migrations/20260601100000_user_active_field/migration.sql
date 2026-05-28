-- Admin carry-over — patient soft-disable.
--
-- Adds `active` + the three audit columns (`deactivated_at`,
-- `deactivation_reason`, `deactivated_by_admin_id`) to `users`. The
-- column defaults to TRUE so every existing row stays active without a
-- backfill step — safe on `users` regardless of size.
--
-- `deactivated_by_admin_id` is UUID-typed but has NO foreign key:
-- `users` and `admin_users` are intentionally disjoint auth domains
-- (CLAUDE.md "Admin / Ops console"). The id is recorded for audit
-- replay only; AdminAuditLog already carries the authoritative trail.
--
-- The index on (active) covers the admin "show deactivated users"
-- filter. Selectivity is fine in practice: > 99% of rows are TRUE so
-- the index is small and only used for the rare FALSE scan.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivated_by_admin_id" UUID,
ADD COLUMN     "deactivation_reason" TEXT;

-- CreateIndex
CREATE INDEX "users_active_idx" ON "users"("active");
