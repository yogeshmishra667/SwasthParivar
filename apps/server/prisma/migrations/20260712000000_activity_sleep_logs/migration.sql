-- Phase 4 Feature I.1 — passive wearable surfaces (additive).
--
-- ActivityDaily + SleepLog: daily aggregates synced from HealthKit /
-- Google Fit (or entered manually). One row per (user, date); the
-- service upserts with manual-wins precedence per CLAUDE.md "Wearable
-- Trust Model — device data is evidence, not truth". Detector
-- eligibility of device rows is gated by the 30-day trust window
-- (Redis `wearable_trust:${userId}:until`), not by this schema — rows
-- are stored + displayed immediately regardless.
--
-- Plain tables (low-volume daily aggregates), not TimescaleDB
-- hypertables. ON DELETE CASCADE from the owning user only.

-- CreateEnum
CREATE TYPE "WearableSource" AS ENUM ('manual', 'healthkit', 'googlefit');

-- CreateEnum
CREATE TYPE "SleepQuality" AS ENUM ('poor', 'fair', 'good');

-- CreateTable
CREATE TABLE "activity_daily" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "steps" INTEGER NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "active_minutes" INTEGER NOT NULL,
    "source" "WearableSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "sleep_start" TIMESTAMP(3) NOT NULL,
    "sleep_end" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "quality" "SleepQuality" NOT NULL,
    "source" "WearableSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sleep_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_daily_user_id_date_idx" ON "activity_daily"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "activity_daily_user_id_date_key" ON "activity_daily"("user_id", "date");

-- CreateIndex
CREATE INDEX "sleep_logs_user_id_date_idx" ON "sleep_logs"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "sleep_logs_user_id_date_key" ON "sleep_logs"("user_id", "date");

-- AddForeignKey
ALTER TABLE "activity_daily" ADD CONSTRAINT "activity_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_logs" ADD CONSTRAINT "sleep_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

