import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { env, isDev } from "../config/env.js";
import { logger } from "./logger.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: isDev ? ["warn", "error"] : ["error"],
});

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  await pool.end();
  logger.info("database disconnected");
};
