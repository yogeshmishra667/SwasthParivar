-- Phase 2 — Meal logs.
--
-- Captures meal context (type + category) for the meal-correlation
-- detector and post-meal glucose attribution. Mirrors the bp_readings /
-- glucose_readings hypertable shape: composite PK on (id, logged_at) so
-- the table is TimescaleDB-hypertable-ready. The hypertable conversion
-- (`SELECT create_hypertable('meal_logs', 'logged_at', if_not_exists => TRUE)`)
-- runs in test setup and the production runbook, not this migration —
-- keeps the schema portable to plain Postgres.

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- CreateEnum
CREATE TYPE "MealCategory" AS ENUM ('light', 'normal', 'heavy_fried');

-- CreateTable
CREATE TABLE "meal_logs" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "meal_category" "MealCategory" NOT NULL,
    "food_description" TEXT,
    "logged_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_logs_pkey" PRIMARY KEY ("id","logged_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_logs_client_uuid_logged_at_key" ON "meal_logs"("client_uuid", "logged_at");

-- CreateIndex
CREATE INDEX "meal_logs_user_id_logged_at_idx" ON "meal_logs"("user_id", "logged_at");

-- CreateIndex — supports meal-correlation detector grouping by category.
CREATE INDEX "meal_logs_user_id_meal_category_logged_at_idx" ON "meal_logs"("user_id", "meal_category", "logged_at");

-- AddForeignKey
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
