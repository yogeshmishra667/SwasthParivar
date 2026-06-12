-- Phase 4 Feature G.1 — Doctor portal schema (additive).
--
-- DoctorProfile + DoctorAppointment + Report. All patient-owned: a
-- doctor row is created by the patient or household primary, NOT by the
-- doctor (doctor-side auth is out of scope for Phase 4). See CLAUDE.md
-- "DoctorProfile / DoctorAppointment" + phase4.md §G.1.
--
-- Schema-only chunk: doctors/appointments/reports modules, the
-- APPOINTMENT_REMINDER cron, and the GENERATE_PDF Puppeteer job ship in
-- later G.* chunks.
--
-- DPDP retention: deleting a DoctorProfile NEVER cascade-deletes a
-- prescription or report (ON DELETE SET NULL on prescriptions.doctor_id
-- and reports.appointment_id). ON DELETE CASCADE only fires when the
-- patient user row itself is deleted (separate forget-me flow).
--
-- This migration also tightens prescriptions.doctor_id — previously a
-- plain UUID with no FK (Feature F.1 deferred it until DoctorProfile
-- existed) — into a real FK with ON DELETE SET NULL.

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('scheduled', 'completed', 'cancelled', 'missed');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('generating', 'ready', 'failed');

-- CreateTable
CREATE TABLE "doctor_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "clinic_name" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_appointments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "pre_visit_report_id" UUID,
    "reminder_sent_7d" BOOLEAN NOT NULL DEFAULT false,
    "reminder_sent_1d" BOOLEAN NOT NULL DEFAULT false,
    "reminder_sent_2h" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appointment_id" UUID,
    "status" "ReportStatus" NOT NULL DEFAULT 'generating',
    "pdf_url" TEXT,
    "pdf_r2_key" TEXT,
    "ai_summary_included" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_profiles_user_id_idx" ON "doctor_profiles"("user_id");

-- CreateIndex
CREATE INDEX "doctor_appointments_user_id_scheduled_at_idx" ON "doctor_appointments"("user_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "doctor_appointments_status_scheduled_at_idx" ON "doctor_appointments"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "reports_user_id_created_at_idx" ON "reports"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "doctor_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (tighten the Feature F.1-deferred plain UUID into a real FK)
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
