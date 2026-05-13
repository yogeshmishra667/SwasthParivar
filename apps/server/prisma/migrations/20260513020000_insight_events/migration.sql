-- Phase 2 — Insight engine output table.
--
-- Detectors (step 3b/3c) emit DetectorResult; the ANALYZE_READING worker
-- persists each non-null result as a row here. Severity gates UI ordering
-- (info → warn → critical), confidence < 0.7 gates visibility (still
-- stored, suppressed from the feed).
--
-- Hypertable-ready: composite PK on (id, created_at). The
-- `create_hypertable('insight_events', 'created_at')` conversion runs in
-- test setup and the production runbook, matching the existing pattern
-- for glucose_readings / bp_readings / meal_logs.

-- CreateEnum
CREATE TYPE "InsightPatternType" AS ENUM ('spike', 'trend', 'meal_correlation', 'anomaly', 'cross_condition');

-- CreateEnum
CREATE TYPE "InsightSeverityLevel" AS ENUM ('info', 'warn', 'critical');

-- CreateTable
CREATE TABLE "insight_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pattern_type" "InsightPatternType" NOT NULL,
    "conditions_involved" TEXT[],
    "severity_score" INTEGER NOT NULL,
    "severity_level" "InsightSeverityLevel" NOT NULL,
    "message_key" TEXT NOT NULL,
    "message_params" JSONB NOT NULL DEFAULT '{}',
    "trigger_readings" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "helpful" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "insight_events_pkey" PRIMARY KEY ("id","created_at")
);

-- CreateIndex
CREATE INDEX "insight_events_user_id_created_at_idx" ON "insight_events"("user_id", "created_at");

-- CreateIndex — supports the "show me unacknowledged insights" feed query.
CREATE INDEX "insight_events_user_id_acknowledged_created_at_idx" ON "insight_events"("user_id", "acknowledged", "created_at");

-- AddForeignKey
ALTER TABLE "insight_events" ADD CONSTRAINT "insight_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
