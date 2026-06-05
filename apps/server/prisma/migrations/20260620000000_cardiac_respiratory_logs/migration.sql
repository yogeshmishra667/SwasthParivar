-- Phase 4 Feature E.1 — Cardiac + Respiratory readings.
--
-- Mirrors the bp_readings / glucose_readings shape: composite PK on
-- (id, measured_at) so the table is TimescaleDB-hypertable-ready.
-- The hypertable conversion
--   SELECT create_hypertable('cardiac_logs', 'measured_at', if_not_exists => TRUE);
--   SELECT create_hypertable('respiratory_logs', 'measured_at', if_not_exists => TRUE);
-- is applied outside this migration, matching the existing repo
-- pattern (test setup + production runbook). Keeping the conversion
-- separate avoids requiring a TimescaleDB-aware migration runner;
-- plain Postgres still accepts the schema.
--
-- ActivityDaily + SleepLog are NOT in this migration — phase4.md §E.1
-- notes they ship in Feature I (Week 19) and are not hypertables.

-- CreateEnum
CREATE TYPE "RhythmStatus" AS ENUM ('regular', 'irregular', 'unknown');

-- CreateEnum
CREATE TYPE "ExerciseTolerance" AS ENUM ('normal', 'reduced', 'severe');

-- CreateEnum
CREATE TYPE "SymptomSeverity" AS ENUM ('none', 'mild', 'moderate', 'severe');

-- CreateTable
CREATE TABLE "cardiac_logs" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "heart_rate" INTEGER NOT NULL,
    "rhythm_status" "RhythmStatus" NOT NULL DEFAULT 'unknown',
    "chest_pain" BOOLEAN NOT NULL DEFAULT false,
    "pain_severity" INTEGER,
    "exercise_tolerance" "ExerciseTolerance" NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "source" "ReadingSource" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardiac_logs_pkey" PRIMARY KEY ("id","measured_at")
);

-- CreateTable
CREATE TABLE "respiratory_logs" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "peak_flow" INTEGER,
    "baseline_peak_flow" INTEGER,
    "inhaler_used" BOOLEAN NOT NULL DEFAULT false,
    "inhaler_type" TEXT,
    "puffs" INTEGER,
    "trigger_note" TEXT,
    "symptom_severity" "SymptomSeverity" NOT NULL DEFAULT 'none',
    "notes" TEXT,
    "source" "ReadingSource" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respiratory_logs_pkey" PRIMARY KEY ("id","measured_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "cardiac_logs_client_uuid_measured_at_key" ON "cardiac_logs"("client_uuid", "measured_at");

-- CreateIndex
CREATE INDEX "cardiac_logs_user_id_measured_at_idx" ON "cardiac_logs"("user_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "respiratory_logs_client_uuid_measured_at_key" ON "respiratory_logs"("client_uuid", "measured_at");

-- CreateIndex
CREATE INDEX "respiratory_logs_user_id_measured_at_idx" ON "respiratory_logs"("user_id", "measured_at");

-- AddForeignKey
ALTER TABLE "cardiac_logs" ADD CONSTRAINT "cardiac_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respiratory_logs" ADD CONSTRAINT "respiratory_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
