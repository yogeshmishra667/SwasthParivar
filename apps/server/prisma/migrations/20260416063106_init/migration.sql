-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('hi', 'en');

-- CreateEnum
CREATE TYPE "Condition" AS ENUM ('diabetes', 'hypertension', 'asthma', 'cardiac');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('free', 'premium', 'family');

-- CreateEnum
CREATE TYPE "GlucoseReadingType" AS ENUM ('fasting', 'pre_meal', 'post_meal', 'random', 'bedtime');

-- CreateEnum
CREATE TYPE "ReadingSource" AS ENUM ('manual', 'voice', 'device');

-- CreateEnum
CREATE TYPE "ReadingContext" AS ENUM ('normal', 'festive');

-- CreateEnum
CREATE TYPE "MedicationLogStatus" AS ENUM ('taken', 'skipped', 'missed_no_response', 'delayed');

-- CreateEnum
CREATE TYPE "FeedbackTone" AS ENUM ('celebrate', 'neutral', 'gentle_warn', 'encourage');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('first_reading', 'post_log_compare', 'streak_milestone', 'critical_warn', 'festive');

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" "Gender",
    "preferred_language" "Language" NOT NULL DEFAULT 'hi',
    "conditions" "Condition"[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "household_id" UUID NOT NULL,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_step" INTEGER NOT NULL DEFAULT 0,
    "tier" "Tier" NOT NULL DEFAULT 'free',
    "time_anomaly_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "is_guardian" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glucose_readings" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "value_mg_dl" INTEGER NOT NULL,
    "reading_type" "GlucoseReadingType" NOT NULL,
    "context" "ReadingContext" NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "source" "ReadingSource" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "streak_credited_to" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glucose_readings_pkey" PRIMARY KEY ("id","measured_at")
);

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "medicine_name" TEXT NOT NULL,
    "dosage" TEXT,
    "time_slots" JSONB NOT NULL,
    "condition" TEXT,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "photo_url" TEXT,
    "quantity_remaining" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_logs" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MedicationLogStatus" NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "skip_reason" TEXT,
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "guardian_alerted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_streaks" (
    "user_id" UUID NOT NULL,
    "current_streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak_days" INTEGER NOT NULL DEFAULT 0,
    "last_log_date" DATE,
    "streak_started_at" TIMESTAMP(3),
    "total_log_days" INTEGER NOT NULL DEFAULT 0,
    "broken_streak_length" INTEGER NOT NULL DEFAULT 0,
    "grace_used_this_week" INTEGER NOT NULL DEFAULT 0,
    "milestones_reached" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_streaks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "feedback_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reading_id" UUID,
    "feedback_type" "FeedbackType" NOT NULL,
    "tone" "FeedbackTone" NOT NULL,
    "message_key" TEXT NOT NULL,
    "message_variant_index" INTEGER NOT NULL,
    "message_params" JSONB NOT NULL,
    "shown_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_states" (
    "user_id" UUID NOT NULL,
    "fatigue_level" INTEGER NOT NULL DEFAULT 0,
    "consecutive_ignores" INTEGER NOT NULL DEFAULT 0,
    "last_notification_at" TIMESTAMP(3),
    "best_log_time_fasting" TEXT NOT NULL DEFAULT '07:00',
    "best_log_time_post_meal" TEXT NOT NULL DEFAULT '13:30',
    "notification_history_7d" JSONB NOT NULL DEFAULT '[]',
    "last_3_variant_ids" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_states_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_household_id_idx" ON "users"("household_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_user_id_priority_idx" ON "emergency_contacts"("user_id", "priority");

-- CreateIndex
CREATE INDEX "glucose_readings_user_id_measured_at_idx" ON "glucose_readings"("user_id", "measured_at");

-- CreateIndex
CREATE INDEX "glucose_readings_user_id_reading_type_measured_at_idx" ON "glucose_readings"("user_id", "reading_type", "measured_at");

-- CreateIndex
CREATE INDEX "glucose_readings_user_id_streak_credited_to_idx" ON "glucose_readings"("user_id", "streak_credited_to");

-- CreateIndex
CREATE UNIQUE INDEX "glucose_readings_client_uuid_measured_at_key" ON "glucose_readings"("client_uuid", "measured_at");

-- CreateIndex
CREATE INDEX "medication_schedules_user_id_active_idx" ON "medication_schedules"("user_id", "active");

-- CreateIndex
CREATE INDEX "medication_logs_user_id_scheduled_for_idx" ON "medication_logs"("user_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "medication_logs_schedule_id_scheduled_for_idx" ON "medication_logs"("schedule_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "feedback_events_user_id_shown_at_idx" ON "feedback_events"("user_id", "shown_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glucose_readings" ADD CONSTRAINT "glucose_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "medication_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_streaks" ADD CONSTRAINT "user_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_states" ADD CONSTRAINT "notification_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
