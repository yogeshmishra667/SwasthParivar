// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./generate-report.processor.js` instead.
import type { Worker } from "bullmq";

import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { processGenerateReport, type GenerateReportJob } from "./generate-report.processor.js";

export type { GenerateReportJob } from "./generate-report.processor.js";

export const generateReportWorker: Worker<GenerateReportJob> = createWorker<GenerateReportJob>(
  QUEUE_NAMES.GENERATE_PDF,
  processGenerateReport,
);
