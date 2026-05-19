/**
 * Phase 3 — AI Chat (job enqueue helpers)
 *
 * Thin wrapper around the CHAT_SAFETY_REVIEW queue. Kept in the module
 * folder per the per-module job convention (readings.jobs.ts /
 * medications.jobs.ts), so the request path doesn't import the
 * worker file (which side-effectfully starts a BullMQ listener).
 */

import type { Queue } from "bullmq";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import type { ChatSafetyReviewJob } from "../../workers/chat-safety-review.processor.js";
import { logger } from "../../shared/logger.js";

const safetyReviewQueue: Queue<ChatSafetyReviewJob> = createQueue<ChatSafetyReviewJob>(
  QUEUE_NAMES.CHAT_SAFETY_REVIEW,
);

export const enqueueChatSafetyReview = async (job: ChatSafetyReviewJob): Promise<void> => {
  try {
    await safetyReviewQueue.add("review", job, {
      // Deterministic jobId so an in-flight retry doesn't create
      // duplicate audit rows. `-` separator per BullMQ jobId rules
      // (see fix/server-bullmq-jobids cherry-pick on main).
      jobId: `safety-review-${job.messageId}`,
    });
  } catch (err) {
    // Audit-trail enqueue failure must not break the patient
    // response — log + swallow.
    logger.error(
      { err, messageId: job.messageId, userId: job.userId },
      "failed to enqueue chat-safety-review job",
    );
  }
};
