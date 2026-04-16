import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("error", (err) => logger.error({ err }, "redis error"));
redis.on("ready", () => logger.info("redis ready"));

export const disconnectRedis = async (): Promise<void> => {
  await redis.quit();
  logger.info("redis disconnected");
};
