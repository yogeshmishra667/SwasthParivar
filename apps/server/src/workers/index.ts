import { criticalAlertWorker } from "./critical-alert.worker.js";
import { analyzeReadingWorker } from "./analyze-reading.worker.js";
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
import { chatSafetyReviewWorker } from "./chat-safety-review.worker.js";
import {
  chatRetentionSweepWorker,
  bootstrapChatRetentionSweepCron,
} from "./chat-retention-sweep.worker.js";
import {
  silentGuardianAnalyzeWorker,
  bootstrapSilentGuardianAnalyzeCron,
} from "./silent-guardian-analyze.worker.js";
import { guardianAlertDispatchWorker } from "./guardian-alert-dispatch.worker.js";
import {
  dailyGuardianSummaryWorker,
  bootstrapDailyGuardianSummaryCron,
} from "./daily-guardian-summary.worker.js";
import { sosEscalationWorker } from "./sos-escalation.worker.js";

import { criticalBypassAutoEscalateWorker } from "./critical-bypass-auto-escalate.worker.js";

import {
  scheduleComplianceWorker,
  bootstrapScheduleComplianceCron,
} from "./schedule-compliance.worker.js";

import { logger } from "../shared/logger.js";

const workers = [
  criticalAlertWorker,
  analyzeReadingWorker,
  medReminderWorker,
  medMissedAlertWorker,
  notificationTriggerWorker,
  graceResetWorker,
  dailyHealthScoreWorker,
  chatSafetyReviewWorker,
  chatRetentionSweepWorker,
  silentGuardianAnalyzeWorker,
  guardianAlertDispatchWorker,
  dailyGuardianSummaryWorker,
  sosEscalationWorker,

  criticalBypassAutoEscalateWorker,

  scheduleComplianceWorker,
];

export const workerNames = [
  "critical-alert",
  "analyze-reading",
  "med-reminder",
  "med-missed-alert",
  "notification-trigger",
  "grace-reset",
  "daily-health-score",
  "chat-safety-review",
  "chat-retention-sweep",
  "silent-guardian-analyze",
  "guardian-alert-dispatch",
  "daily-guardian-summary",
  "sos-escalation",

  "critical-bypass-auto-escalate",

  "schedule-compliance",
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
  bootstrapChatRetentionSweepCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap chat-retention-sweep cron"),
  );
  bootstrapSilentGuardianAnalyzeCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap silent-guardian-analyze cron"),
  );
  bootstrapDailyGuardianSummaryCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap daily-guardian-summary cron"),
  );
  bootstrapScheduleComplianceCron().catch((err) =>
    logger.error({ err }, "failed to bootstrap schedule-compliance cron"),
  );
  logger.info({ count: workers.length }, "workers started");
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  logger.info("workers stopped");
};
