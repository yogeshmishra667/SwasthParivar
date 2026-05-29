// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./schedule-compliance.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processScheduleComplianceCheck,
  type ScheduleComplianceCheckJob,
} from "./schedule-compliance.processor.js";

export type { ScheduleComplianceCheckJob } from "./schedule-compliance.processor.js";

// Hourly, at minute 5 — keeps the tick clear of the 00 minute when
// most other crons fire (daily-health-score, notification-trigger).
const REPEAT_PATTERN = "5 * * * *";
const REPEAT_KEY = "schedule-compliance-hourly";

const queue = createQueue<ScheduleComplianceCheckJob>(QUEUE_NAMES.SCHEDULE_COMPLIANCE_CHECK);

export const bootstrapScheduleComplianceCron = async (): Promise<void> => {
  await queue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const scheduleComplianceWorker: Worker<ScheduleComplianceCheckJob> =
  createWorker<ScheduleComplianceCheckJob>(
    QUEUE_NAMES.SCHEDULE_COMPLIANCE_CHECK,
    processScheduleComplianceCheck,
  );
