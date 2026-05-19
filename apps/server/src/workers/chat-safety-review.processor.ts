/**
 * Phase 3 — AI Chat Safety Review processor
 *
 * Fires when chat.service detects an unsafe assistant response via the
 * Post-Response Safety Filter. The processor:
 *   1. Re-loads the ChatMessage by id (the row was already persisted
 *      with flagged=true + safety_violations[] in the request path).
 *   2. Emits a PostHog audit event (`chat_safety_filter_rejected`).
 *   3. Captures a Sentry error so on-call sees the rejection rate.
 *
 * The processor is intentionally idempotent: re-running on the same
 * row is a no-op. No new DB writes — the request path already did
 * the durable work. This worker exists so observability stays async
 * (the patient response doesn't wait on PostHog / Sentry I/O).
 *
 * Retry policy comes from the queue default (3 attempts, exp 5s).
 */

import type { Job } from "bullmq";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { captureUnhandled as captureSentry } from "../shared/observability/sentry.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";

export interface ChatSafetyReviewJob {
  messageId: string;
  userId: string;
  // Forwarded for log/Sentry correlation. Optional because cron/retry
  // paths may not have an originating HTTP request.
  requestId?: string;
}

export const processChatSafetyReview = async (job: Job<ChatSafetyReviewJob>): Promise<void> => {
  const { messageId, userId, requestId } = job.data;
  const row = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      flagged: true,
      flagReason: true,
      safetyViolations: true,
      costTier: true,
      createdAt: true,
    },
  });
  if (!row) {
    logger.warn(
      { jobId: job.id, messageId, requestId },
      "chat-safety-review: message not found (likely deleted)",
    );
    return;
  }
  if (!row.flagged) {
    // Should not happen — chat.service only enqueues on filter
    // rejection. Defensive log if it does.
    logger.warn(
      { jobId: job.id, messageId },
      "chat-safety-review: message no longer flagged — skipping",
    );
    return;
  }

  const violations = Array.isArray(row.safetyViolations) ? (row.safetyViolations as string[]) : [];

  // PostHog event — drives the safety-review dashboard.
  captureAnalyticsEvent("ai_chat_safety_filter_rejected", userId, {
    message_id: row.id,
    violations,
    cost_tier: row.costTier,
    flag_reason: row.flagReason ?? "safety_filter_rejected",
  });

  // Sentry error — pages on-call when rejection rate spikes. No PII —
  // tags only.
  captureSentry(new Error("chat_safety_filter_rejected"), {
    message_id: row.id,
    user_id: userId,
    violations,
    cost_tier: row.costTier,
    request_id: requestId,
  });

  logger.info(
    {
      jobId: job.id,
      messageId,
      userId,
      violations,
      costTier: row.costTier,
      requestId,
    },
    "chat-safety-review processed",
  );
};
