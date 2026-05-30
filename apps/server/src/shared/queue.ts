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
  GRACE_RESET: "grace-reset",
  DAILY_HEALTH_SCORE: "daily-health-score",
  // Phase 3 — fired when filterChatResponse flags an assistant
  // message. The processor persists into the human-audit queue and
  // emits PostHog; nothing in the patient request path waits on it.
  CHAT_SAFETY_REVIEW: "chat-safety-review",
  // Phase 3 — weekly cron. Archives chat sessions at 90 days and
  // hard-deletes them at 1 year (CC.11 §5 — DPDP retention).
  CHAT_RETENTION_SWEEP: "chat-retention-sweep",
  // Phase 3 Feature C — daily cron. Per patient with an accepted
  // guardian link: detect + score Silent Guardian signals, aggregate
  // risk, and conditionally create a GuardianAlert. Gated by the
  // `silent_guardian_enabled` flag.
  SILENT_GUARDIAN_ANALYZE: "silent-guardian-analyze",
  // Phase 3 Feature C — fired on GuardianAlert create. Push (primary) →
  // SMS (fallback) delivery of one alert, after the weekly-orange cap +
  // critical-bypass dedup. Gated by `silent_guardian_alerts_dispatch`.
  GUARDIAN_ALERT_DISPATCH: "guardian-alert-dispatch",
  // Phase 4 Feature D' — SOS escalation tick. Self-rescheduling job;
  // each run reads the SOSEvent row, calls `nextSOSStage`, and writes
  // back. Exits the loop when the state machine reaches `resolved` /
  // `cancelled`. Gated by `sos_enabled`; side effects gated by
  // `sos_test_mode`.
  SOS_ESCALATION: "sos-escalation",
  // Phase 2 carry-over (Week 17). Hourly tick that walks every active
  // `HealthCheckSchedule`, runs the pure `evaluateCompliance` on the
  // last 24h window, and UPSERTs `HealthCheckCompliance` rows by
  // `(scheduleId, expectedAt)`. Idempotent across re-runs. Gated by
  // `schedule_compliance_check_enabled` (default true).
  SCHEDULE_COMPLIANCE_CHECK: "schedule-compliance-check",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

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
