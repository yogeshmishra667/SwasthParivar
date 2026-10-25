// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./critical-alert.processor.js` instead.
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import { processCriticalAlert, type CriticalAlertJob } from "./critical-alert.processor.js";

export type { CriticalAlertJob } from "./critical-alert.processor.js";

export const criticalAlertWorker: Worker<CriticalAlertJob> = createWorker<CriticalAlertJob>(
  QUEUE_NAMES.CRITICAL_ALERT,
  processCriticalAlert,
);

// A critical alert that failed for good may have reached no one — page
// on-call (the generic queue handler only logs). `finishedOn` is set only
// on a terminal failure, which also covers stalled / unrecoverable jobs
// that end before their last attempt.
criticalAlertWorker.on("failed", (job, err) => {
  if (job && (job.finishedOn !== undefined || job.attemptsMade >= (job.opts.attempts ?? 1))) {
    captureUnhandled(err, {
      queue: QUEUE_NAMES.CRITICAL_ALERT,
      jobId: job.id,
      userId: job.data.userId,
      readingId: job.data.readingId,
      attemptsMade: job.attemptsMade,
    });
  }
});
