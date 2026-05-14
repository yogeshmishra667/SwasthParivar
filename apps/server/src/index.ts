import { initSentry, captureUnhandled, warnIfMisconfigured } from "./shared/observability/sentry.js";
initSentry();

import os from "node:os";
import { buildApp } from "./app.js";
import { env, isDev } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { prisma, disconnectDatabase } from "./shared/database.js";
import { redis, disconnectRedis } from "./shared/redis.js";
import { closeQueueConnection } from "./shared/queue.js";
import { startWorkers, stopWorkers, workerNames } from "./workers/index.js";

warnIfMisconfigured((msg) => logger.warn(msg));

const lanAddresses = (): string[] => {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
};

interface PingResult {
  ok: boolean;
  ms: number;
  err?: string;
}

const pingDb = async (): Promise<PingResult> => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, err: (err as Error).message };
  }
};

const pingRedis = async (): Promise<PingResult> => {
  const start = Date.now();
  try {
    const res = await redis.ping();
    return { ok: res === "PONG", ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, err: (err as Error).message };
  }
};

const printBanner = async (): Promise<void> => {
  const [db, r] = await Promise.all([pingDb(), pingRedis()]);
  const lans = lanAddresses();

  if (!isDev) {
    logger.info(
      { db: db.ok, redis: r.ok, workers: workerNames.length, port: env.PORT },
      "server ready",
    );
    return;
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("┌─ SwasthParivar server");
  lines.push(`│  → http://localhost:${env.PORT}`);
  for (const ip of lans) lines.push(`│  → http://${ip}:${env.PORT}   (LAN)`);
  lines.push(`│  → http://localhost:${env.PORT}/health`);
  lines.push(`│  env: ${env.NODE_ENV} · node: ${process.version} · pid: ${process.pid}`);
  lines.push(`│  db:      ${db.ok ? `ok (${db.ms}ms)` : `FAIL — ${db.err ?? "unknown"}`}`);
  lines.push(`│  redis:   ${r.ok ? `ok (${r.ms}ms)` : `FAIL — ${r.err ?? "unknown"}`}`);
  lines.push(`│  workers: ${workerNames.length} (${workerNames.join(", ")})`);
  lines.push("└─");
  lines.push("");
  process.stdout.write(lines.join("\n"));
};

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "server listening");
});

startWorkers();

// Banner runs after the event loop drains the initial sync logs.
setImmediate(() => {
  void printBanner();
});

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
  captureUnhandled(reason, { source: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
  captureUnhandled(err, { source: "uncaughtException" });
});
