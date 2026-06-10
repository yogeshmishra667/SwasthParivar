// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./prescription-clarification-ocr.processor.js`
// directly.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import type { PrescriptionClarificationOcrJob } from "../modules/prescriptions/prescriptions.types.js";
import { processPrescriptionClarificationOcr } from "./prescription-clarification-ocr.processor.js";

export const prescriptionClarificationOcrWorker: Worker<PrescriptionClarificationOcrJob> =
  createWorker<PrescriptionClarificationOcrJob>(
    QUEUE_NAMES.PRESCRIPTION_CLARIFICATION_OCR,
    processPrescriptionClarificationOcr,
  );
