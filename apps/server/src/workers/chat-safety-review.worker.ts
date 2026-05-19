// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./chat-safety-review.processor.js` instead.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processChatSafetyReview,
  type ChatSafetyReviewJob,
} from "./chat-safety-review.processor.js";

export type { ChatSafetyReviewJob } from "./chat-safety-review.processor.js";

export const chatSafetyReviewWorker: Worker<ChatSafetyReviewJob> =
  createWorker<ChatSafetyReviewJob>(QUEUE_NAMES.CHAT_SAFETY_REVIEW, processChatSafetyReview);
