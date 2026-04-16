import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { ok } from "../../shared/http.js";
import { prisma } from "../../shared/database.js";

export const streaksRouter: Router = Router();

streaksRouter.use(requireAuth);

streaksRouter.get("/current", async (req: Request, res: Response) => {
  const streak = await prisma.userStreak.findUnique({ where: { userId: req.auth!.sub } });
  ok(res, streak ?? { currentStreakDays: 0, longestStreakDays: 0 });
});

streaksRouter.get("/milestones", async (req: Request, res: Response) => {
  const streak = await prisma.userStreak.findUnique({ where: { userId: req.auth!.sub } });
  ok(res, { reached: (streak?.milestonesReached as number[]) ?? [] });
});
