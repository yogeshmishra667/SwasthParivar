// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./silent-guardian-analyze.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processSilentGuardianAnalyze,
  type SilentGuardianAnalyzeJob,
} from "./silent-guardian-analyze.processor.js";

export type { SilentGuardianAnalyzeJob } from "./silent-guardian-analyze.processor.js";

// 18:00 IST = 12:30 UTC — early evening, after the day's medications and
// readings are mostly logged, so a guardian gets a settled end-of-day
// picture. A single daily tick fans out to all patients inside the
// processor (the same shape as daily-health-score); per-timezone
// scatter is a scale optimisation deferred until fan-out warrants it.
const REPEAT_PATTERN = "30 12 * * *"; // 12:30 UTC daily
const REPEAT_KEY = "silent-guardian-analyze-daily";

const silentGuardianAnalyzeQueue = createQueue<SilentGuardianAnalyzeJob>(
  QUEUE_NAMES.SILENT_GUARDIAN_ANALYZE,
);

export const bootstrapSilentGuardianAnalyzeCron = async (): Promise<void> => {
  await silentGuardianAnalyzeQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const silentGuardianAnalyzeWorker: Worker<SilentGuardianAnalyzeJob> =
  createWorker<SilentGuardianAnalyzeJob>(
    QUEUE_NAMES.SILENT_GUARDIAN_ANALYZE,
    processSilentGuardianAnalyze,
  );
