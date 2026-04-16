import { Router, type Request, type Response } from "express";
import { prisma } from "../../shared/database.js";
import { redis } from "../../shared/redis.js";

export const healthRouter: Router = Router();

healthRouter.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

healthRouter.get("/health/deep", async (_req: Request, res: Response) => {
  const checks: Record<string, "ok" | "fail"> = { db: "ok", redis: "ok" };
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks["db"] = "fail";
  }
  try {
    await redis.ping();
  } catch {
    checks["redis"] = "fail";
  }
  const allOk = Object.values(checks).every((v) => v === "ok");
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});
