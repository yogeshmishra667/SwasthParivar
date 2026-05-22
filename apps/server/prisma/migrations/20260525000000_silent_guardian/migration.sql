-- Phase 3 Feature C — Silent Guardian (signals + alerts).
--
-- Two new regular tables (not TimescaleDB hypertables — low-volume
-- alert/event rows with FK relations, not time-series telemetry):
--   silent_guardian_signals — per-patient detected concerns, scored 0-100
--   guardian_alerts         — fired alerts, one patient side + guardian side
--
-- Fully additive and non-locking: new enums, new tables, new indexes,
-- new FKs to an existing table. No existing column is altered. Safe to
-- apply online. Reverse SQL is documented in docs/runbooks/rollback.md.

-- CreateEnum
CREATE TYPE "SignalSource" AS ENUM ('med_adherence', 'data_anomaly');

-- CreateEnum
CREATE TYPE "GuardianAlertType" AS ENUM ('trend_concern', 'med_adherence', 'combined');

-- CreateEnum
CREATE TYPE "GuardianAlertSeverity" AS ENUM ('yellow', 'orange');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('push', 'sms', 'in_app');

-- CreateTable
CREATE TABLE "silent_guardian_signals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "signal_source" "SignalSource" NOT NULL,
    "signal_type" TEXT NOT NULL,
    "raw_evidence" JSONB NOT NULL DEFAULT '{}',
    "risk_contribution" INTEGER NOT NULL,
    "decay_factor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_by_alert" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silent_guardian_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_alerts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "alert_type" "GuardianAlertType" NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "severity" "GuardianAlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT NOT NULL,
    "suggested_action" TEXT NOT NULL,
    "signal_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_via" "AlertChannel"[] DEFAULT ARRAY[]::"AlertChannel"[],
    "push_delivered" BOOLEAN NOT NULL DEFAULT false,
    "sms_delivered" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardian_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "silent_guardian_signals_user_id_detected_at_idx" ON "silent_guardian_signals"("user_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "silent_guardian_signals_consumed_by_alert_idx" ON "silent_guardian_signals"("consumed_by_alert");

-- CreateIndex
CREATE INDEX "guardian_alerts_guardian_id_created_at_idx" ON "guardian_alerts"("guardian_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "guardian_alerts_patient_id_created_at_idx" ON "guardian_alerts"("patient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "guardian_alerts_severity_created_at_idx" ON "guardian_alerts"("severity", "created_at");

-- AddForeignKey
ALTER TABLE "silent_guardian_signals" ADD CONSTRAINT "silent_guardian_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_alerts" ADD CONSTRAINT "guardian_alerts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_alerts" ADD CONSTRAINT "guardian_alerts_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
