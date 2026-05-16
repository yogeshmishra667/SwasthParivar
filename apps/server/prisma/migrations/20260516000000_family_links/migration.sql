-- Phase 2 step 7 — FamilyLink table (guardian read-only view).
--
-- A patient creates a `pending` invite for a guardian. The guardian
-- accepts (or declines) it; either side can revoke later. Phase 2 only
-- consumes the `accepted` rows from the /family endpoints. Phase 3
-- alerts will reuse these same rows without a schema change.
--
-- One row per (patient, guardian) pair regardless of status — re-invite
-- after a revoke updates the existing row in place. Active-conflict
-- detection (FAMILY_LINK_EXISTS) lives in the service layer.

-- CreateEnum
CREATE TYPE "FamilyLinkStatus" AS ENUM ('pending', 'accepted', 'declined', 'revoked');

-- CreateEnum
CREATE TYPE "FamilyAlertSensitivity" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "family_links" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relationship" TEXT,
    "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "visible_conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alert_sensitivity" "FamilyAlertSensitivity" NOT NULL DEFAULT 'medium',
    "status" "FamilyLinkStatus" NOT NULL DEFAULT 'pending',
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_links_patient_id_guardian_id_key" ON "family_links"("patient_id", "guardian_id");

-- CreateIndex
CREATE INDEX "family_links_guardian_id_status_idx" ON "family_links"("guardian_id", "status");

-- CreateIndex
CREATE INDEX "family_links_patient_id_status_idx" ON "family_links"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "family_links" ADD CONSTRAINT "family_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_links" ADD CONSTRAINT "family_links_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
