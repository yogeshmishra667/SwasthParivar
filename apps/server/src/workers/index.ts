import { criticalAlertWorker } from "./critical-alert.worker.js";
import { logger } from "../shared/logger.js";

const workers = [criticalAlertWorker];

export const startWorkers = (): void => {
  logger.info({ count: workers.length }, "workers started");
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  logger.info("workers stopped");
};
