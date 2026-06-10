// Enqueue helpers for Phase 4 §F.5 prescription jobs. Stays a thin
// wrapper around `createQueue` so the service layer doesn't import
// BullMQ directly; same pattern as `medications.jobs.ts`.

import type { Queue } from "bullmq";

import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import type { PrescriptionOcrJob } from "../../workers/prescription-ocr.processor.js";
import type {
  MedicinePhotoCrossCheckJob,
  PrescriptionClarificationOcrJob,
  PrescriptionOcrDeltaJob,
} from "./prescriptions.types.js";

const ocrQueue: Queue<PrescriptionOcrJob> = createQueue<PrescriptionOcrJob>(
  QUEUE_NAMES.PRESCRIPTION_OCR,
);
const clarificationQueue: Queue<PrescriptionClarificationOcrJob> =
  createQueue<PrescriptionClarificationOcrJob>(QUEUE_NAMES.PRESCRIPTION_CLARIFICATION_OCR);
const crossCheckQueue: Queue<MedicinePhotoCrossCheckJob> = createQueue<MedicinePhotoCrossCheckJob>(
  QUEUE_NAMES.MEDICINE_PHOTO_CROSS_CHECK,
);
const ocrDeltaQueue: Queue<PrescriptionOcrDeltaJob> = createQueue<PrescriptionOcrDeltaJob>(
  QUEUE_NAMES.PRESCRIPTION_OCR_DELTA,
);

/**
 * Enqueue the PRESCRIPTION_OCR pipeline. Idempotent by `prescriptionId`
 * — BullMQ dedup on `jobId` + the processor's own status guard. Safe
 * to call from the upload route's commit handler under
 * `prisma.$transaction` because the worker re-fetches the row before
 * doing any work.
 */
export const enqueuePrescriptionOcr = async (job: PrescriptionOcrJob): Promise<void> => {
  await ocrQueue.add("ocr", job, { jobId: `ocr-${job.prescriptionId}` });
};

/**
 * Enqueue a clarification pass. Idempotent on `${itemId}:${attemptId}`
 * so a mobile retry never double-charges Vision spend.
 */
export const enqueueClarificationOcr = async (
  job: PrescriptionClarificationOcrJob,
): Promise<void> => {
  await clarificationQueue.add("clarify", job, {
    jobId: `clarify-${job.itemId}-${job.clarificationAttemptId}`,
  });
};

/**
 * Enqueue a post-schedule routine cross-check. Idempotent per
 * MedicinePhoto.id — re-running on a photo that already has a
 * matchStatus is a no-op in the processor.
 */
export const enqueueMedicinePhotoCrossCheck = async (
  job: MedicinePhotoCrossCheckJob,
): Promise<void> => {
  await crossCheckQueue.add("cross-check", job, {
    jobId: `cross-check-${job.medicinePhotoId}`,
  });
};

/**
 * Enqueue an incremental OCR pass for an append upload. Idempotent on
 * `${prescriptionId}:${deltaUploadId}` so a flaky mobile retry of the
 * same append never double-charges Vision spend or double-creates items.
 */
export const enqueuePrescriptionOcrDelta = async (job: PrescriptionOcrDeltaJob): Promise<void> => {
  await ocrDeltaQueue.add("ocr-delta", job, {
    jobId: `ocr-delta-${job.prescriptionId}-${job.deltaUploadId}`,
  });
};
