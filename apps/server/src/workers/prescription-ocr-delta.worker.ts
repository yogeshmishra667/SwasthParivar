// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./prescription-ocr-delta.processor.js` directly.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { processPrescriptionOcrDelta } from "./prescription-ocr-delta.processor.js";
import type { PrescriptionOcrDeltaJob } from "../modules/prescriptions/prescriptions.types.js";

export const prescriptionOcrDeltaWorker: Worker<PrescriptionOcrDeltaJob> =
  createWorker<PrescriptionOcrDeltaJob>(
    QUEUE_NAMES.PRESCRIPTION_OCR_DELTA,
    processPrescriptionOcrDelta,
  );
