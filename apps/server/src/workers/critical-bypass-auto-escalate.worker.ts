// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./critical-bypass-auto-escalate.processor.js` instead.
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processCriticalBypassAutoEscalate,
  type CriticalBypassAutoEscalateJob,
} from "./critical-bypass-auto-escalate.processor.js";

export type { CriticalBypassAutoEscalateJob } from "./critical-bypass-auto-escalate.processor.js";

export const criticalBypassAutoEscalateWorker: Worker<CriticalBypassAutoEscalateJob> =
  createWorker<CriticalBypassAutoEscalateJob>(
    QUEUE_NAMES.CRITICAL_BYPASS_AUTO_ESCALATE,
    processCriticalBypassAutoEscalate,
  );
