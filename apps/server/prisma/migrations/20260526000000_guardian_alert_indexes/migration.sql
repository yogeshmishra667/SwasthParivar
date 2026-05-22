-- Phase 3 Feature C — Silent Guardian audit follow-up.
--
-- Two composite indexes on guardian_alerts that back hot query paths
-- the original feature migration did not cover:
--   * (guardian_id, patient_id, created_at) — the GUARDIAN_ALERT_DISPATCH
--     weekly-orange-cap lookup and the per-patient daily summary
--   * (guardian_id, severity, created_at) — the DAILY_GUARDIAN_SUMMARY
--     yellow-alert count
--
-- Additive and non-locking: CREATE INDEX on a table that is empty at
-- migration time. Safe to apply online.

-- CreateIndex
CREATE INDEX "guardian_alerts_guardian_id_patient_id_created_at_idx" ON "guardian_alerts"("guardian_id", "patient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "guardian_alerts_guardian_id_severity_created_at_idx" ON "guardian_alerts"("guardian_id", "severity", "created_at" DESC);
