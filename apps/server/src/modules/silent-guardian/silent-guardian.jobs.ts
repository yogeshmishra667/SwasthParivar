// Phase 3 Feature C — Silent Guardian job-enqueue helper.
//
// Kept in the module folder per the per-module job convention
// (chat.jobs.ts / medications.jobs.ts) so the SILENT_GUARDIAN_ANALYZE
// worker can enqueue a dispatch job without importing the dispatch
// worker file (which side-effectfully starts a BullMQ listener).

import type { Queue } from "bullmq";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import type { GuardianAlertDispatchJob } from "../../workers/guardian-alert-dispatch.processor.js";
import { logger } from "../../shared/logger.js";

const dispatchQueue: Queue<GuardianAlertDispatchJob> = createQueue<GuardianAlertDispatchJob>(
  QUEUE_NAMES.GUARDIAN_ALERT_DISPATCH,
);

export const enqueueGuardianAlertDispatch = async (alertId: string): Promise<void> => {
  try {
    await dispatchQueue.add(
      "dispatch",
      { alertId },
      // Deterministic jobId — a re-enqueue for the same alert never
      // creates a duplicate dispatch. `-` separator per BullMQ rules.
      { jobId: `guardian-alert-dispatch-${alertId}` },
    );
  } catch (err) {
    // A failed enqueue must not break the analyze batch — the alert row
    // already exists and is visible in-app; log and move on.
    logger.error({ err, alertId }, "failed to enqueue guardian-alert-dispatch job");
  }
};
