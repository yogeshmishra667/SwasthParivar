// MEDICINE_PHOTO_CROSS_CHECK processor — phase4.md §F.5 / §F.8.
//
// Triggered by the CLAUDE.md "Medicine bottle photo" post-schedule
// routine flow. Once a MedicationSchedule exists, the patient can keep
// snapping bottle photos for ongoing safety: "is this still the right
// medicine?" The processor runs ONE Vision Pass-B against the photo,
// compares the AI-read name to the linked schedule's medicineName, and
// writes the result into `MedicinePhoto.matchStatus`.
//
// IMPORTANT: this is FLAG-ONLY. A mismatch never auto-deactivates a
// schedule or auto-pages a guardian — it surfaces a banner on the
// patient's medication screen ("Yeh aapki dawai jaisi nahi lag rahi —
// guardian se confirm karein") and rolls up in the admin "drifting
// schedules" report. Per phase4.md §F.8 "Mismatch flag only (NOT auto-
// action)."
//
// Idempotency: jobId = `cross-check-${medicinePhotoId}`. The processor
// also short-circuits when `matchStatus !== "not_attempted"` so a retry
// after a successful write is a no-op.
//
// Spend cap: shares the F.4 `prescription_ocr_enabled` flag with the
// initial OCR worker. Vision outages affect both.

import { createHash } from "node:crypto";

import type { Job } from "bullmq";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import { generateVisionResponse } from "../shared/ai/claude-vision.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import type { MedicinePhotoCrossCheckJob } from "../modules/prescriptions/prescriptions.types.js";

const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex");
const anonymiseUserId = (userId: string): string => `anon_${sha256Hex(userId).slice(0, 16)}`;

export const processMedicinePhotoCrossCheck = async (
  job: Job<MedicinePhotoCrossCheckJob>,
): Promise<void> => {
  const { medicinePhotoId, medicationScheduleId, userId, requestId } = job.data;

  const enabled = await getFlag<boolean>("prescription_ocr_enabled", false);
  if (enabled !== true) {
    logger.warn(
      { medicinePhotoId, jobId: job.id },
      "prescription_ocr_enabled=false — skipping cross-check job",
    );
    return;
  }

  const photo = await prisma.medicinePhoto.findUnique({
    where: { id: medicinePhotoId },
  });
  if (!photo) {
    logger.warn({ medicinePhotoId, jobId: job.id }, "medicine photo not found — skipping");
    return;
  }
  if (photo.uploadedAt !== "post_schedule_routine_check") {
    // Defensive — only routine-check photos belong on this queue. An
    // initial_upload or clarification photo here means a service-layer
    // bug; refuse to act on it.
    logger.error(
      { medicinePhotoId, uploadedAt: photo.uploadedAt, jobId: job.id },
      "wrong uploadedAt context for cross-check queue — refusing",
    );
    return;
  }
  if (photo.matchStatus !== "not_attempted") {
    logger.info(
      { medicinePhotoId, matchStatus: photo.matchStatus, jobId: job.id },
      "cross-check already recorded — idempotent skip",
    );
    return;
  }
  const schedule = await prisma.medicationSchedule.findUnique({
    where: { id: medicationScheduleId },
    select: { medicineName: true },
  });
  if (!schedule) {
    logger.warn(
      { medicationScheduleId, jobId: job.id },
      "linked medication schedule not found — skipping cross-check",
    );
    return;
  }

  try {
    const response = await generateVisionResponse({
      mode: "medicine_bottle",
      images: [{ kind: "url", url: photo.photoUrl }],
      context: {
        anonymizedPatientId: anonymiseUserId(userId),
        prescriptionId: photo.prescriptionId ?? medicationScheduleId,
      },
      userId,
      requestId,
    });
    if (response.mode !== "medicine_bottle") return;

    const aiReadName = response.bottle.aiReadName;
    const matchStatus = bottleMatchesSchedule(aiReadName, schedule.medicineName)
      ? "match"
      : aiReadName === ""
        ? "unclear"
        : "mismatch";

    await prisma.medicinePhoto.update({
      where: { id: photo.id },
      data: {
        aiReadName,
        matchConfidence: response.bottle.confidence,
        matchStatus,
        verified: matchStatus === "match",
      },
    });

    captureAnalyticsEvent("prescription_ocr_completed", userId, {
      prescription_id: photo.prescriptionId ?? medicationScheduleId,
      item_count: 0,
      bottle_count: 1,
      page_count: 0,
      request_id: requestId,
    });
  } catch (err) {
    logger.error(
      { err, medicinePhotoId, jobId: job.id },
      "medicine-photo cross-check Vision call failed",
    );
    throw err;
  }
};

/**
 * Same case-insensitive substring/bigram heuristic as the clarification
 * worker. Conservative — a mismatch is the strong signal; an ambiguous
 * reading falls into "unclear" upstream.
 */
const bottleMatchesSchedule = (aiReadName: string, scheduleName: string): boolean => {
  if (!aiReadName || !scheduleName) return false;
  const a = aiReadName.trim().toLowerCase();
  const b = scheduleName.trim().toLowerCase();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / (A.size + B.size - shared) >= 0.6;
};
