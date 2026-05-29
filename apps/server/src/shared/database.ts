import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { env, isDev } from "../config/env.js";
import { logger } from "./logger.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// Two pg error codes are benign during graceful teardown:
//   57P01 admin_shutdown            — server is going down (Testcontainers
//                                     stopping mid-`pool.end()` on CI).
//   08006 connection_failure        — socket closed while client was in
//                                     `_ending` state.
// pg's Pool emits these on the underlying Client after `pool.end()` has
// already resolved; without a listener Node turns them into an
// uncaughtException and Vitest fails the run despite all tests passing.
// In prod the same handler keeps a transient Postgres restart from
// crashing the worker — the next request reconnects via the pool.
const handleBenignPgError = (err: Error & { code?: string }): void => {
  if (err.code === "57P01" || err.code === "08006") return;
  logger.error({ err }, "pg error");
};
pool.on("error", handleBenignPgError);
// Attach the same handler to every client the pool spins up. During
// `pool.end()` a client can emit `error` *after* the pool has stopped
// proxying its events; without a per-client listener Node treats it
// as an uncaughtException.
pool.on("connect", (client) => {
  client.on("error", handleBenignPgError);
});

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
