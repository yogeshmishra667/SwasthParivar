import { Queue, Worker, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const QUEUE_NAMES = {
  ANALYZE_READING: "analyze-reading",
  UPDATE_STREAK: "update-streak",
  TRIGGER_NOTIFICATION: "trigger-notification",
  MED_REMINDER: "med-reminder",
  MED_MISSED_ALERT: "med-missed-alert",
  DAILY_GUARDIAN_SUMMARY: "daily-guardian-summary",
  CRITICAL_ALERT: "critical-alert",
  RE_ENGAGEMENT: "re-engagement",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const createQueue = <T>(name: QueueName): Queue<T> =>
  new Queue<T>(name, {
    connection: bullConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    },
  });

export const createWorker = <T>(name: QueueName, processor: Processor<T>): Worker<T> => {
  const worker = new Worker<T>(name, processor, {
    connection: bullConnection,
    concurrency: 5,
  });
  worker.on("failed", (job, err) =>
    logger.error({ queue: name, jobId: job?.id, err }, "job failed"),
  );
  return worker;
};

export const closeQueueConnection = async (): Promise<void> => {
  await bullConnection.quit();
};
