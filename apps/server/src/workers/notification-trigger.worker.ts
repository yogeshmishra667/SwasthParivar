import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { processNotificationTriggerTick } from "./notification-trigger.processor.js";

interface TickJob {
  tick: true;
}

const triggerQueue = createQueue<TickJob>(QUEUE_NAMES.TRIGGER_NOTIFICATION);

const REPEAT_PATTERN = "*/15 * * * *";
const REPEAT_KEY = "notification-trigger-tick";

export const bootstrapNotificationCron = async (): Promise<void> => {
  await triggerQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "Asia/Kolkata", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const notificationTriggerWorker: Worker<TickJob> = createWorker<TickJob>(
  QUEUE_NAMES.TRIGGER_NOTIFICATION,
  async () => {
    await processNotificationTriggerTick(new Date());
  },
);
