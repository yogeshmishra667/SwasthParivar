import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { ok } from "../../shared/http.js";
import { prisma } from "../../shared/database.js";

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req: Request, res: Response) => {
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const [streak, latest, todayCount, schedules] = await Promise.all([
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.glucoseReading.findFirst({
      where: { userId },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.glucoseReading.count({
      where: {
        userId,
        measuredAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
      },
    }),
    prisma.medicationSchedule.findMany({ where: { userId, active: true } }),
  ]);

  ok(res, {
    streak: streak ?? { currentStreakDays: 0 },
    latestReading: latest,
    todayReadingCount: todayCount,
    medications: schedules,
  });
});
