// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./daily-health-score.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processDailyHealthScore,
  type DailyHealthScoreJob,
} from "./daily-health-score.processor.js";

export type { DailyHealthScoreJob } from "./daily-health-score.processor.js";

// 06:00 IST = 00:30 UTC (IST = UTC+5:30). The number is the patient's
// morning, not midnight, so they wake up to a fresh dashboard.
const REPEAT_PATTERN = "30 0 * * *"; // 00:30 UTC daily
const REPEAT_KEY = "health-score:daily";

const dailyHealthScoreQueue = createQueue<DailyHealthScoreJob>(QUEUE_NAMES.DAILY_HEALTH_SCORE);

export const bootstrapDailyHealthScoreCron = async (): Promise<void> => {
  await dailyHealthScoreQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const dailyHealthScoreWorker: Worker<DailyHealthScoreJob> =
  createWorker<DailyHealthScoreJob>(QUEUE_NAMES.DAILY_HEALTH_SCORE, processDailyHealthScore);
