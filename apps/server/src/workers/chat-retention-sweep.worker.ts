// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./chat-retention-sweep.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processChatRetentionSweep,
  type ChatRetentionSweepJob,
} from "./chat-retention-sweep.processor.js";

export type { ChatRetentionSweepJob } from "./chat-retention-sweep.processor.js";

// Weekly — Sunday 20:00 UTC (Monday 01:30 IST). Off-peak, and
// staggered from the Sunday 21:30 UTC grace-reset cron.
const REPEAT_PATTERN = "0 20 * * 0";
const REPEAT_KEY = "chat-retention-weekly-sweep";

const chatRetentionSweepQueue = createQueue<ChatRetentionSweepJob>(
  QUEUE_NAMES.CHAT_RETENTION_SWEEP,
);

export const bootstrapChatRetentionSweepCron = async (): Promise<void> => {
  await chatRetentionSweepQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const chatRetentionSweepWorker: Worker<ChatRetentionSweepJob> =
  createWorker<ChatRetentionSweepJob>(QUEUE_NAMES.CHAT_RETENTION_SWEEP, processChatRetentionSweep);
