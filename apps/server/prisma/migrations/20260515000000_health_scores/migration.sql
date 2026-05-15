-- Phase 2 step 5 — Daily HealthScore table.
--
-- DAILY_HEALTH_SCORE worker (06:00 IST) computes a 0-100 score per user
-- per day, blending 5 components (logging 20%, stability 25%, trend 25%,
-- medication 20%, streak 10%) defined in @swasth/domain-logic. Cron is
-- idempotent: a unique constraint on (user_id, computed_for_date) makes
-- re-runs an UPSERT, not a duplicate insert.
--
-- Not a hypertable — one row per user per day is small. Composite PK
-- pattern reserved for the high-volume reading tables.

-- CreateTable
CREATE TABLE "health_scores" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "components" JSONB NOT NULL DEFAULT '{}',
    "computed_for_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_scores_user_id_computed_for_date_key" ON "health_scores"("user_id", "computed_for_date");

-- CreateIndex
CREATE INDEX "health_scores_user_id_computed_for_date_idx" ON "health_scores"("user_id", "computed_for_date");

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
