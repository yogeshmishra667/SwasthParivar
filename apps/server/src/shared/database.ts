import { PrismaClient } from "@prisma/client";
import { env, isDev } from "../config/env.js";
import { logger } from "./logger.js";

export const prisma = new PrismaClient({
  log: isDev ? ["warn", "error"] : ["error"],
  datasources: { db: { url: env.DATABASE_URL } },
});

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info("database disconnected");
};
