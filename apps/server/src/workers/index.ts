import { criticalAlertWorker } from "./critical-alert.worker.js";
import { medReminderWorker, medMissedAlertWorker } from "./med-reminder.worker.js";
import {
  notificationTriggerWorker,
  bootstrapNotificationCron,
} from "./notification-trigger.worker.js";
import { graceResetWorker, bootstrapGraceResetCron } from "./grace-reset.worker.js";
import {
  dailyHealthScoreWorker,
  bootstrapDailyHealthScoreCron,
} from "./daily-health-score.worker.js";
import { logger } from "../shared/logger.js";

const workers = [
  criticalAlertWorker,
  medReminderWorker,
  medMissedAlertWorker,
  notificationTriggerWorker,
  graceResetWorker,
  dailyHealthScoreWorker,
];

export const workerNames = [
  "critical-alert",
  "med-reminder",
  "med-missed-alert",
  "notification-trigger",
  "grace-reset",
  "daily-health-score",
];

export const startWorkers = (): void => {
  bootstrapNotificationCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap notification cron"),
  );
  bootstrapGraceResetCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap grace-reset cron"),
  );
  bootstrapDailyHealthScoreCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap daily-health-score cron"),
  );
  logger.info({ count: workers.length }, "workers started");
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  logger.info("workers stopped");
};
