-- Phase 4 Feature D' — SOSEvent table.
--
-- One row per SOS press. The escalation cron walks the state machine
-- (pure logic in packages/domain-logic/src/sos-escalation/) and
-- mutates `escalation_stage` + `contacts_notified` as the chain
-- progresses. Ship-default `test_mode=true` so call/SMS/IVR side
-- effects log-only until the `sos_test_mode` flag is flipped — see
-- docs/runbooks/sos-drill.md.
--
-- `client_uuid` is the mobile-side dedup key: same SOS press fired
-- twice (flaky network retry) collapses to the same row. Soft-delete
-- is via `resolved_at` + `false_alarm`; rows are retained for the
-- medical / forensic trail (DPDP).
--
-- Indexes are tailored to the three real reads:
--   1. most-recent-per-user — active event lookup + after-action card
--   2. (resolved_at, escalation_stage) — worker pulls "still active"
--   3. (test_mode, triggered_at) — ops grep "what fired in test mode"

-- CreateEnum
CREATE TYPE "SOSTriggerSource" AS ENUM ('patient_manual', 'critical_bypass_escalation', 'guardian_initiated');

-- CreateEnum
CREATE TYPE "SOSEscalationStage" AS ENUM ('stage_0_fullscreen', 'stage_1_auto_dial', 'stage_2_ivr_call', 'stage_3_all_contacts', 'resolved', 'cancelled');

-- CreateTable
CREATE TABLE "sos_events" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_source" "SOSTriggerSource" NOT NULL,
    "location_lat" DOUBLE PRECISION,
    "location_lng" DOUBLE PRECISION,
    "location_accuracy_m" INTEGER,
    "last_readings" JSONB NOT NULL DEFAULT '{}',
    "contacts_notified" JSONB NOT NULL DEFAULT '[]',
    "escalation_stage" "SOSEscalationStage" NOT NULL DEFAULT 'stage_0_fullscreen',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "false_alarm" BOOLEAN NOT NULL DEFAULT false,
    "test_mode" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sos_events_client_uuid_key" ON "sos_events"("client_uuid");

-- CreateIndex
CREATE INDEX "sos_events_user_id_triggered_at_idx" ON "sos_events"("user_id", "triggered_at" DESC);

-- CreateIndex
CREATE INDEX "sos_events_resolved_at_escalation_stage_idx" ON "sos_events"("resolved_at", "escalation_stage");

-- CreateIndex
CREATE INDEX "sos_events_test_mode_triggered_at_idx" ON "sos_events"("test_mode", "triggered_at" DESC);

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
