// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./daily-guardian-summary.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processDailyGuardianSummary,
  type DailyGuardianSummaryJob,
} from "./daily-guardian-summary.processor.js";

export type { DailyGuardianSummaryJob } from "./daily-guardian-summary.processor.js";

// 20:00 IST = 14:30 UTC — end of day, after SILENT_GUARDIAN_ANALYZE
// (12:30 UTC) has produced the day's alerts.
const REPEAT_PATTERN = "30 14 * * *"; // 14:30 UTC daily
const REPEAT_KEY = "daily-guardian-summary";

const dailyGuardianSummaryQueue = createQueue<DailyGuardianSummaryJob>(
  QUEUE_NAMES.DAILY_GUARDIAN_SUMMARY,
);

export const bootstrapDailyGuardianSummaryCron = async (): Promise<void> => {
  await dailyGuardianSummaryQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const dailyGuardianSummaryWorker: Worker<DailyGuardianSummaryJob> =
  createWorker<DailyGuardianSummaryJob>(
    QUEUE_NAMES.DAILY_GUARDIAN_SUMMARY,
    processDailyGuardianSummary,
  );
