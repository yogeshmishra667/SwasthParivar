-- Reconcile schema.prisma with the migration history (no data change).
--
-- Found by replaying every migration into an empty database and running
-- `prisma migrate diff --from-config-datasource --to-schema` against
-- schema.prisma (now a CI step). Two drifts:
--
-- 1. admin_audit_logs: schema.prisma declares
--    @@index([targetId, createdAt(sort: Desc)]) but the 20260527 admin
--    console migration only created the admin_user_id and action indexes.
--    Created here so "what happened to this flag / user" audit lookups
--    stop scanning the table.
--
-- 2. indian_food_items: the 20260711 migration created the GIN
--    (jsonb_path_ops) index on name_regional, but schema.prisma never
--    declared it, so the next `prisma migrate dev` would have generated a
--    DROP INDEX. Fixed in schema.prisma only (the index already exists);
--    nothing to run here.

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_id_created_at_idx" ON "admin_audit_logs"("target_id", "created_at" DESC);
