import type { BypassDecision } from "@swasth/domain-logic";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { logger } from "../shared/logger.js";

export interface CriticalAlertJob {
  readingId: string;
  userId: string;
  decision: BypassDecision;
}

export const criticalAlertWorker = createWorker<CriticalAlertJob>(
  QUEUE_NAMES.CRITICAL_ALERT,
  async (job) => {
    const { decision, userId, readingId } = job.data;
    logger.warn(
      { userId, readingId, severity: decision.severity, pushTargets: decision.pushTargets },
      "CRITICAL bypass dispatch",
    );

    // Phase 1 integrations (stubs — wire actual clients next):
    // 1. Expo push to decision.pushTargets
    // 2. MSG91 SMS to decision.smsTargets (fallback when push fails)
    // 3. Fullscreen alert is client-driven; nothing to do server-side
    // 4. Call button is client UI; nothing to do server-side
  },
);
