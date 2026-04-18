import { criticalAlertWorker } from "./critical-alert.worker.js";
import { medReminderWorker, medMissedAlertWorker } from "./med-reminder.worker.js";
import {
  notificationTriggerWorker,
  bootstrapNotificationCron,
} from "./notification-trigger.worker.js";
import { logger } from "../shared/logger.js";

const workers = [
  criticalAlertWorker,
  medReminderWorker,
  medMissedAlertWorker,
  notificationTriggerWorker,
];

export const startWorkers = (): void => {
  bootstrapNotificationCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap notification cron"),
  );
  logger.info({ count: workers.length }, "workers started");
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  logger.info("workers stopped");
};
