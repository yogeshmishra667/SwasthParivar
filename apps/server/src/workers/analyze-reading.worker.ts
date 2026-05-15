// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./analyze-reading.processor.js` instead.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processAnalyzeReading,
  type AnalyzeReadingJob,
} from "./analyze-reading.processor.js";

export type { AnalyzeReadingJob } from "./analyze-reading.processor.js";

export const analyzeReadingWorker: Worker<AnalyzeReadingJob> =
  createWorker<AnalyzeReadingJob>(QUEUE_NAMES.ANALYZE_READING, processAnalyzeReading);
