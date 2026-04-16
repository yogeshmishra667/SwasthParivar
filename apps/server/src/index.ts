import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { disconnectDatabase } from "./shared/database.js";
import { disconnectRedis } from "./shared/redis.js";
import { closeQueueConnection } from "./shared/queue.js";
import { startWorkers, stopWorkers } from "./workers/index.js";

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "server listening");
});

startWorkers();

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "graceful shutdown initiated");
  server.close(() => logger.info("http server closed"));
  await stopWorkers();
  await closeQueueConnection();
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled rejection");
});
