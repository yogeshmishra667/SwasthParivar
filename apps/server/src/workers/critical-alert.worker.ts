// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./critical-alert.processor.js` instead.
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { processCriticalAlert, type CriticalAlertJob } from "./critical-alert.processor.js";

export type { CriticalAlertJob } from "./critical-alert.processor.js";

export const criticalAlertWorker: Worker<CriticalAlertJob> = createWorker<CriticalAlertJob>(
  QUEUE_NAMES.CRITICAL_ALERT,
  processCriticalAlert,
);
