// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./prescription-ocr.processor.js` directly.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { processPrescriptionOcr, type PrescriptionOcrJob } from "./prescription-ocr.processor.js";

export type { PrescriptionOcrJob } from "./prescription-ocr.processor.js";

export const prescriptionOcrWorker: Worker<PrescriptionOcrJob> = createWorker<PrescriptionOcrJob>(
  QUEUE_NAMES.PRESCRIPTION_OCR,
  processPrescriptionOcr,
);
