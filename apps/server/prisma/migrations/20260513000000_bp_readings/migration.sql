-- Phase 2 — BP readings module.
--
-- Mirrors the glucose_readings shape: composite PK on (id, measured_at)
-- so the table is TimescaleDB-hypertable-ready. The hypertable conversion
-- (`SELECT create_hypertable('bp_readings', 'measured_at', if_not_exists => TRUE)`)
-- is applied outside this migration, matching the existing repo pattern
-- for glucose_readings (test setup + production runbook). Keeping the
-- conversion separate avoids requiring a TimescaleDB-aware migration
-- runner; plain Postgres still accepts the schema.

-- CreateTable
CREATE TABLE "bp_readings" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse" INTEGER,
    "context" "ReadingContext" NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "source" "ReadingSource" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bp_readings_pkey" PRIMARY KEY ("id","measured_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "bp_readings_client_uuid_measured_at_key" ON "bp_readings"("client_uuid", "measured_at");

-- CreateIndex
CREATE INDEX "bp_readings_user_id_measured_at_idx" ON "bp_readings"("user_id", "measured_at");

-- AddForeignKey
ALTER TABLE "bp_readings" ADD CONSTRAINT "bp_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
