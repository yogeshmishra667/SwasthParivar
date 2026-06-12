// Thin enqueue wrapper so the reports service never imports the worker
// (which is side-effecting — importing it starts a BullMQ listener).
// Mirrors prescriptions.jobs.ts.

import type { Queue } from "bullmq";

import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import type { GenerateReportJob } from "./reports.types.js";

const generateQueue: Queue<GenerateReportJob> = createQueue<GenerateReportJob>(
  QUEUE_NAMES.GENERATE_PDF,
);

// jobId = reportId so a duplicate enqueue for the same report is a no-op
// at the BullMQ layer (belt-and-suspenders with the service-side dedup).
// 3 retries with exponential backoff per phase4.md §G ("GENERATE_PDF …
// 3 retries").
export const enqueueGenerateReport = async (job: GenerateReportJob): Promise<void> => {
  await generateQueue.add("generate", job, {
    jobId: `report-${job.reportId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  });
};
