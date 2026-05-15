// HealthScore module service — returns the most-recent stored score
// for a user, or computes on-the-fly if the DAILY_HEALTH_SCORE worker
// hasn't run yet (cold-start path).
//
// Caching strategy (CLAUDE.md "Caching (Redis)"): health-score 24h TTL,
// keyed by user. The worker invalidates `health-score:<userId>` when it
// writes a fresh row, so the dashboard sees the new score immediately
// without waiting for cache expiry.

import { computeHealthScore, type HealthScore } from "@swasth/domain-logic";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { redis } from "../../shared/redis.js";

export type { HealthScore };

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const dayMs = 86_400_000;

const cacheKey = (userId: string): string => `health-score:${userId}`;

const buildPayload = (
  stored: {
    score: number;
    components: unknown;
    computedForDate: Date;
    updatedAt: Date;
  } | null,
  liveFallback: HealthScore | null,
): HealthScore | null => {
  if (stored !== null) {
    return {
      score: stored.score,
      components: stored.components as HealthScore["components"],
      weights: { logging: 20, stability: 25, trend: 25, medication: 20, streak: 10 },
      computedForDate: stored.computedForDate.toISOString().slice(0, 10),
      computedAtIso: stored.updatedAt.toISOString(),
    };
  }
  return liveFallback;
};

export interface GetHealthScoreInput {
  userId: string;
}

export const getHealthScore = async (input: GetHealthScoreInput): Promise<HealthScore | null> => {
  const key = cacheKey(input.userId);

  // Cache read — best-effort.
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as HealthScore;
    }
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "health-score cache read failed");
  }

  // Latest stored row from the daily worker.
  const stored = await prisma.healthScore.findFirst({
    where: { userId: input.userId },
    orderBy: { computedForDate: "desc" },
  });

  let result: HealthScore | null;
  if (stored !== null) {
    result = buildPayload(stored, null);
  } else {
    // Cold start: the daily worker hasn't run yet. Compute on-the-fly so
    // the patient sees a number on their first dashboard load.
    const now = new Date();
    const cutoff14d = new Date(now.getTime() - 14 * dayMs);
    const cutoff30d = new Date(now.getTime() - 30 * dayMs);

    const [allReadings14d, fasting14d, fasting30d, medLogs14d, streak] = await Promise.all([
      prisma.glucoseReading.findMany({
        where: { userId: input.userId, measuredAt: { gte: cutoff14d } },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.glucoseReading.findMany({
        where: {
          userId: input.userId,
          readingType: "fasting",
          measuredAt: { gte: cutoff14d },
        },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.glucoseReading.findMany({
        where: {
          userId: input.userId,
          readingType: "fasting",
          measuredAt: { gte: cutoff30d },
        },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.medicationLog.findMany({
        where: { userId: input.userId, createdAt: { gte: cutoff14d } },
        select: { status: true },
      }),
      prisma.userStreak.findUnique({
        where: { userId: input.userId },
        select: { currentStreakDays: true },
      }),
    ]);

    result = computeHealthScore({
      allReadingsLast14d: allReadings14d.map((r) => ({
        valueMgDl: r.valueMgDl,
        measuredAt: r.measuredAt.toISOString(),
      })),
      fastingReadingsLast14d: fasting14d.map((r) => ({
        valueMgDl: r.valueMgDl,
        measuredAt: r.measuredAt.toISOString(),
      })),
      fastingReadingsLast30d: fasting30d.map((r) => ({
        valueMgDl: r.valueMgDl,
        measuredAt: r.measuredAt.toISOString(),
      })),
      medicationLogsLast14d: medLogs14d.map((l) => ({ status: l.status })),
      currentStreakDays: streak?.currentStreakDays ?? 0,
      now,
    });
  }

  if (result === null) return null;

  // Cache write — best-effort.
  try {
    await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "health-score cache write failed");
  }

  return result;
};
