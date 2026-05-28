-- Phase 2 carry-over — HealthCheckSchedule + HealthCheckCompliance.
--
-- CLAUDE.md "Scheduling" specced these tables in Phase 2; they slipped
-- and land in Week 13 of Phase 4 as additive schema only. The
-- SCHEDULE_COMPLIANCE_CHECK cron, the doctor-portal adherence display,
-- and the mobile schedule editor all ship in Week 17. This migration
-- introduces no patient-facing behaviour by itself.
--
-- Compliance evaluation is pure (`packages/domain-logic/src/schedule-compliance/`).
-- The worker that persists evaluated rows will UPSERT on
-- (schedule_id, expected_at) so re-runs are idempotent.

-- CreateEnum
CREATE TYPE "HealthCheckType" AS ENUM ('glucose', 'bp', 'cardiac', 'respiratory');

-- CreateEnum
CREATE TYPE "HealthCheckFrequency" AS ENUM ('daily', 'weekly');

-- CreateEnum
CREATE TYPE "HealthCheckComplianceStatus" AS ENUM ('on_time', 'late', 'missed', 'pending');

-- CreateTable
CREATE TABLE "health_check_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_type" "HealthCheckType" NOT NULL,
    "frequency" "HealthCheckFrequency" NOT NULL,
    "scheduled_times" JSONB NOT NULL,
    "reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_check_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_check_compliance" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expected_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "reading_id" TEXT,
    "status" "HealthCheckComplianceStatus" NOT NULL,
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "guardian_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_check_compliance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_check_schedules_user_id_active_idx" ON "health_check_schedules"("user_id", "active");

-- CreateIndex
CREATE INDEX "health_check_schedules_user_id_check_type_active_idx" ON "health_check_schedules"("user_id", "check_type", "active");

-- CreateIndex
CREATE INDEX "health_check_compliance_user_id_expected_at_idx" ON "health_check_compliance"("user_id", "expected_at" DESC);

-- CreateIndex
CREATE INDEX "health_check_compliance_schedule_id_status_idx" ON "health_check_compliance"("schedule_id", "status");

-- CreateIndex
CREATE INDEX "health_check_compliance_user_id_status_expected_at_idx" ON "health_check_compliance"("user_id", "status", "expected_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_check_compliance_schedule_id_expected_at_key" ON "health_check_compliance"("schedule_id", "expected_at");

-- AddForeignKey
ALTER TABLE "health_check_schedules" ADD CONSTRAINT "health_check_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_check_compliance" ADD CONSTRAINT "health_check_compliance_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "health_check_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_check_compliance" ADD CONSTRAINT "health_check_compliance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
