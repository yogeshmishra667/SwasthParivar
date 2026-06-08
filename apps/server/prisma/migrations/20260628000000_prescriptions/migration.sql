-- Phase 4 Feature F.1 — Prescription OCR schema (additive).
--
-- "AI suggests, guardian decides" — every Vision pass + every approver
-- tap is appended to PrescriptionItem.ai_suggestion_history so the
-- cabinet contents three months later are fully replayable. See
-- CLAUDE.md "Prescription OCR Approval Flow" + phase4.md §F.1, §F.4,
-- §F.5.
--
-- Schema-only chunk: OCR worker, approver-resolver, color-classifier,
-- and HTTP routes ship in later F.* chunks (F.2 onward). MedicationSchedule
-- gains a back-reference via prescription_items.medication_schedule_id;
-- no MedicationSchedule columns added (Phase 1 medication shape is
-- preserved).
--
-- DPDP retention: rejected/approved prescriptions are RETAINED — never
-- row-deleted. ON DELETE CASCADE only fires when the patient user row
-- itself is deleted (which is a separate forget-me flow).
--
-- doctor_id is a plain UUID column with NO FK in this migration —
-- DoctorProfile lands in Feature G (Week 17). A follow-up migration
-- adds the FK once doctor_profiles exists.

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('pending_ocr', 'pending_approval', 'partial', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PrescriptionItemColor" AS ENUM ('red', 'yellow', 'green', 'need_clarification');

-- CreateEnum
CREATE TYPE "PrescriptionItemStatus" AS ENUM ('pending', 'need_clarification', 'approved', 'rejected', 'needs_doctor');

-- CreateEnum
CREATE TYPE "MedicineMatchStatus" AS ENUM ('match', 'mismatch', 'unclear', 'not_attempted');

-- CreateEnum
CREATE TYPE "MedicinePhotoUploadContext" AS ENUM ('initial_upload', 'mid_approval_clarification', 'post_schedule_routine_check');

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "doctor_id" UUID,
    "original_photo_urls" TEXT[],
    "ocr_raw_result" JSONB NOT NULL DEFAULT '{}',
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'pending_ocr',
    "requires_guardian_approval" BOOLEAN NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "approval_requested_at" TIMESTAMP(3),
    "approval_completed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "prescribed_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "ocr_medicine_name" TEXT NOT NULL,
    "ocr_dosage" TEXT NOT NULL,
    "ocr_frequency" TEXT NOT NULL,
    "ocr_confidence" DOUBLE PRECISION NOT NULL,
    "ocr_alternatives" JSONB,
    "ocr_color" "PrescriptionItemColor" NOT NULL,
    "status" "PrescriptionItemStatus" NOT NULL DEFAULT 'pending',
    "verified_medicine_name" TEXT,
    "verified_dosage" TEXT,
    "verified_frequency" TEXT,
    "medication_schedule_id" UUID,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approver_corrections" JSONB,
    "approver_note" TEXT,
    "paired_medicine_photo_ids" UUID[],
    "ai_suggestion_history" JSONB NOT NULL DEFAULT '[]',
    "clarification_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_photos" (
    "id" UUID NOT NULL,
    "prescription_id" UUID,
    "prescription_item_id" UUID,
    "medication_schedule_id" UUID,
    "photo_url" TEXT NOT NULL,
    "ai_read_name" TEXT,
    "match_status" "MedicineMatchStatus" NOT NULL DEFAULT 'not_attempted',
    "match_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" "MedicinePhotoUploadContext" NOT NULL DEFAULT 'initial_upload',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescriptions_user_id_created_at_idx" ON "prescriptions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "prescriptions_status_idx" ON "prescriptions"("status");

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_idx" ON "prescription_items"("prescription_id");

-- CreateIndex
CREATE INDEX "prescription_items_status_idx" ON "prescription_items"("status");

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_status_idx" ON "prescription_items"("prescription_id", "status");

-- CreateIndex
CREATE INDEX "medicine_photos_prescription_id_idx" ON "medicine_photos"("prescription_id");

-- CreateIndex
CREATE INDEX "medicine_photos_prescription_item_id_idx" ON "medicine_photos"("prescription_item_id");

-- CreateIndex
CREATE INDEX "medicine_photos_medication_schedule_id_idx" ON "medicine_photos"("medication_schedule_id");

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medication_schedule_id_fkey" FOREIGN KEY ("medication_schedule_id") REFERENCES "medication_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_photos" ADD CONSTRAINT "medicine_photos_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_photos" ADD CONSTRAINT "medicine_photos_medication_schedule_id_fkey" FOREIGN KEY ("medication_schedule_id") REFERENCES "medication_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
