// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./guardian-alert-dispatch.processor.js` instead.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processGuardianAlertDispatch,
  type GuardianAlertDispatchJob,
} from "./guardian-alert-dispatch.processor.js";

export type { GuardianAlertDispatchJob } from "./guardian-alert-dispatch.processor.js";

// Event-driven, not cron — enqueued by SILENT_GUARDIAN_ANALYZE on each
// GuardianAlert create. No bootstrap.
export const guardianAlertDispatchWorker: Worker<GuardianAlertDispatchJob> =
  createWorker<GuardianAlertDispatchJob>(
    QUEUE_NAMES.GUARDIAN_ALERT_DISPATCH,
    processGuardianAlertDispatch,
  );
