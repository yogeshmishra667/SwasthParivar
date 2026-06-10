// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./medicine-photo-cross-check.processor.js`
// directly.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import type { MedicinePhotoCrossCheckJob } from "../modules/prescriptions/prescriptions.types.js";
import { processMedicinePhotoCrossCheck } from "./medicine-photo-cross-check.processor.js";

export const medicinePhotoCrossCheckWorker: Worker<MedicinePhotoCrossCheckJob> =
  createWorker<MedicinePhotoCrossCheckJob>(
    QUEUE_NAMES.MEDICINE_PHOTO_CROSS_CHECK,
    processMedicinePhotoCrossCheck,
  );
