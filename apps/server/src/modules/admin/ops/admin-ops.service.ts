// Admin ops surface — BullMQ queue depth, a system-health probe, and the
// maintenance-mode kill switch.

import type { Queue } from "bullmq";
import { prisma } from "../../../shared/database.js";
import { redis } from "../../../shared/redis.js";
import { setFlag } from "../../../shared/flags/index.js";
import { createQueue, QUEUE_NAMES, type QueueName } from "../../../shared/queue.js";
import { logger } from "../../../shared/logger.js";

// Queue handles are memoised — each shares the BullMQ Redis connection,
// so building them once and reusing avoids per-request connection churn.
const queueCache = new Map<QueueName, Queue<unknown>>();
const queueFor = (name: QueueName): Queue<unknown> => {
  let q = queueCache.get(name);
  if (!q) {
    q = createQueue(name);
    queueCache.set(name, q);
  }
  return q;
};

export interface QueueStat {
  name: string;
  /** waiting / active / completed / failed / delayed counts, or null on error. */
  counts: Record<string, number> | null;
  error?: string;
}

export const getQueueStats = async (): Promise<{ queues: QueueStat[] }> => {
  const names = Object.values(QUEUE_NAMES);
  const queues = await Promise.all(
    names.map(async (name): Promise<QueueStat> => {
      try {
        const counts = await queueFor(name).getJobCounts();
        return { name, counts };
      } catch (err) {
        logger.warn({ err, queue: name }, "admin ops: queue stats read failed");
        return { name, counts: null, error: "unavailable" };
      }
    }),
  );
  return { queues };
};

const DEEP_CHECK_TIMEOUT_MS = 3_000;

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export interface SystemHealth {
  status: "ok" | "degraded";
  checks: { db: "ok" | "fail"; redis: "ok" | "fail" };
}

/** Same probes as GET /health/deep, surfaced inside the console. */
export const getSystemHealth = async (): Promise<SystemHealth> => {
  const checks: SystemHealth["checks"] = { db: "ok", redis: "ok" };
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DEEP_CHECK_TIMEOUT_MS);
  } catch {
    checks.db = "fail";
  }
  try {
    await withTimeout(redis.ping(), DEEP_CHECK_TIMEOUT_MS);
  } catch {
    checks.redis = "fail";
  }
  const status = checks.db === "ok" && checks.redis === "ok" ? "ok" : "degraded";
  return { status, checks };
};

/**
 * Flip the global `maintenance_mode` kill switch. When on, the
 * maintenance middleware 503s every patient request (admin + health stay
 * reachable). Hard-guarded by a confirm step on the console.
 */
export const setMaintenanceMode = async (
  enabled: boolean,
  by: string,
): Promise<{ maintenanceMode: boolean }> => {
  await setFlag("maintenance_mode", enabled, by);
  return { maintenanceMode: enabled };
};
