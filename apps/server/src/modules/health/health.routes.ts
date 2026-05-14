import { Router, type Request, type Response } from "express";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";

export const healthRouter: Router = Router();

healthRouter.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

// Per-check timeout for /health/deep. Without this, a half-broken DB or
// Redis connection (network split, deadlocked pool) makes the probe hang
// forever — the orchestrator's liveness check then deadlocks too. 3s is
// well over a healthy round-trip; if the check needs longer than that,
// the system is degraded and should report so.
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

healthRouter.get("/health/deep", async (_req: Request, res: Response) => {
  const checks: Record<string, "ok" | "fail"> = { db: "ok", redis: "ok" };
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
  const allOk = Object.values(checks).every((v) => v === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});
