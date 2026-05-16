// Dashboard service — assembles the data layer for `GET /api/v1/dashboard`.
// Phase 2 step 6 extends the payload to include the Hindi/English
// summary card, latest BP, today's meals, unacknowledged insights
// count, and the latest stored health score.
//
// The natural-language summary is composed by the pure
// `composeDashboardSummary` from @swasth/domain-logic — this file owns
// only the DB reads + the shape mapping.

import {
  composeDashboardSummary,
  type DashboardGlucoseReading,
  type DashboardSummary,
} from "@swasth/domain-logic";

import { prisma } from "../../shared/database.js";

const dayMs = 86_400_000;

export interface BuildDashboardInput {
  userId: string;
}

export interface BuildDashboardResult {
  summary: DashboardSummary;
  streak: { currentStreakDays: number };
  latestReading: unknown;
  todayReadingCount: number;
  medications: unknown[];
  bpLatest: unknown;
  mealsToday: { id: string; mealType: string; mealCategory: string; loggedAt: Date }[];
  insightsUnacknowledgedCount: number;
  healthScore: {
    score: number;
    components: unknown;
    computedForDate: string;
  } | null;
}

const startOfTodayUtc = (): Date => new Date(new Date().toISOString().slice(0, 10));

export const buildDashboard = async (input: BuildDashboardInput): Promise<BuildDashboardResult> => {
  const todayStart = startOfTodayUtc();
  const yesterdayStart = new Date(todayStart.getTime() - dayMs);
  const insightFreshCutoff = new Date(Date.now() - 30 * dayMs);

  // HealthScore landed on feat/health-score; gracefully skip when that
  // branch hasn't been merged into the current deploy (the Prisma model
  // simply doesn't exist on the client yet).
  const healthScoreDelegate = (
    prisma as unknown as {
      healthScore?: {
        findFirst: (args: unknown) => Promise<{
          score: number;
          components: unknown;
          computedForDate: Date;
        } | null>;
      };
    }
  ).healthScore;

  const [
    user,
    streak,
    latestReading,
    todayCount,
    schedules,
    todayGlucose,
    yesterdayFasting,
    todayBp,
    bpLatest,
    mealsToday,
    insightsUnacknowledgedCount,
    latestHealthScore,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { preferredLanguage: true, createdAt: true },
    }),
    prisma.userStreak.findUnique({ where: { userId: input.userId } }),
    prisma.glucoseReading.findFirst({
      where: { userId: input.userId },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.glucoseReading.count({
      where: { userId: input.userId, measuredAt: { gte: todayStart } },
    }),
    prisma.medicationSchedule.findMany({ where: { userId: input.userId, active: true } }),
    prisma.glucoseReading.findMany({
      where: { userId: input.userId, measuredAt: { gte: todayStart } },
      select: { valueMgDl: true, readingType: true, measuredAt: true },
    }),
    prisma.glucoseReading.findMany({
      where: {
        userId: input.userId,
        readingType: "fasting",
        measuredAt: { gte: yesterdayStart, lt: todayStart },
      },
      select: { valueMgDl: true, readingType: true, measuredAt: true },
    }),
    prisma.bPReading.findMany({
      where: { userId: input.userId, measuredAt: { gte: todayStart } },
      select: { systolic: true, diastolic: true, pulse: true, measuredAt: true },
    }),
    prisma.bPReading.findFirst({
      where: { userId: input.userId },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.mealLog.findMany({
      where: { userId: input.userId, loggedAt: { gte: todayStart } },
      select: { id: true, mealType: true, mealCategory: true, loggedAt: true },
      orderBy: { loggedAt: "asc" },
    }),
    // Confidence ≥ 0.7 + not yet acknowledged + still within retention window.
    prisma.insightEvent.count({
      where: {
        userId: input.userId,
        acknowledged: false,
        confidence: { gte: 0.7 },
        createdAt: { gte: insightFreshCutoff },
      },
    }),
    healthScoreDelegate
      ? healthScoreDelegate.findFirst({
          where: { userId: input.userId },
          orderBy: { computedForDate: "desc" },
        })
      : Promise.resolve(null),
  ]);

  const userStageDays = Math.floor((Date.now() - user.createdAt.getTime()) / dayMs);

  const todayGlucoseForSummary: DashboardGlucoseReading[] = todayGlucose.map((r) => ({
    valueMgDl: r.valueMgDl,
    readingType: r.readingType,
    measuredAt: r.measuredAt.toISOString(),
  }));
  const yesterdayFastingForSummary: DashboardGlucoseReading[] = yesterdayFasting.map((r) => ({
    valueMgDl: r.valueMgDl,
    readingType: r.readingType,
    measuredAt: r.measuredAt.toISOString(),
  }));

  const healthScoreSnapshot =
    latestHealthScore !== null
      ? {
          score: latestHealthScore.score,
          components: latestHealthScore.components as {
            logging: number;
            stability: number;
            trend: number;
            medication: number;
            streak: number;
          },
        }
      : null;

  const summary = composeDashboardSummary({
    todayGlucose: todayGlucoseForSummary,
    todayBp: todayBp.map((r) => ({
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      measuredAt: r.measuredAt.toISOString(),
    })),
    yesterdayFasting: yesterdayFastingForSummary,
    healthScore: healthScoreSnapshot,
    currentStreakDays: streak?.currentStreakDays ?? 0,
    userStageDays,
    language: user.preferredLanguage,
  });

  return {
    summary,
    streak: streak ?? { currentStreakDays: 0 },
    latestReading,
    todayReadingCount: todayCount,
    medications: schedules,
    bpLatest,
    mealsToday,
    insightsUnacknowledgedCount,
    healthScore:
      latestHealthScore !== null
        ? {
            score: latestHealthScore.score,
            components: latestHealthScore.components,
            computedForDate: latestHealthScore.computedForDate.toISOString().slice(0, 10),
          }
        : null,
  };
};
