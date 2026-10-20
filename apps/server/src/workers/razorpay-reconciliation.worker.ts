// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./razorpay-reconciliation.processor.js` (or the
// service directly) instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processRazorpayReconciliation,
  type RazorpayReconciliationJob,
} from "./razorpay-reconciliation.processor.js";

export type { RazorpayReconciliationJob } from "./razorpay-reconciliation.processor.js";

// 02:00 UTC daily — a quiet window off the other crons (SG analyze
// 12:30, guardian summary 14:30, appointment reminder hourly at :10).
// Pulling the last 24h each day means one run's window fully covers the
// gap since the previous run.
const REPEAT_PATTERN = "0 2 * * *";
const REPEAT_KEY = "razorpay-reconciliation";

const razorpayReconciliationQueue = createQueue<RazorpayReconciliationJob>(
  QUEUE_NAMES.RAZORPAY_RECONCILIATION,
);

export const bootstrapRazorpayReconciliationCron = async (): Promise<void> => {
  await razorpayReconciliationQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const razorpayReconciliationWorker: Worker<RazorpayReconciliationJob> =
  createWorker<RazorpayReconciliationJob>(
    QUEUE_NAMES.RAZORPAY_RECONCILIATION,
    processRazorpayReconciliation,
  );
