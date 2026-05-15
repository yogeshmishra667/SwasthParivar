// DAILY_HEALTH_SCORE BullMQ processor — fires once a day (06:00 IST,
// 00:30 UTC). For every onboarded user, pulls the inputs needed by
// `computeHealthScore`, computes the score, and upserts the row keyed
// by (userId, computedForDate) so re-runs are idempotent.
//
// Pure-function `computeHealthScore` lives in @swasth/domain-logic. This
// processor owns the Prisma reads + the row upsert + the Redis cache
// invalidation (the GET endpoint caches at `health-score:<userId>`).

import type { Job } from "bullmq";
import { computeHealthScore, type HealthScoreInput } from "@swasth/domain-logic";
import type { Prisma } from "@prisma/client";

import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { redis } from "../shared/redis.js";

const dayMs = 86_400_000;

export interface DailyHealthScoreJob {
  tick: true;
}

const buildInputForUser = async (userId: string, now: Date): Promise<HealthScoreInput> => {
  const cutoff14d = new Date(now.getTime() - 14 * dayMs);
  const cutoff30d = new Date(now.getTime() - 30 * dayMs);

  // Fetch everything we need in parallel — each user's daily compute is
  // 4 indexed reads, all keyed on userId + measuredAt/loggedAt range.
  const [allReadings14d, fastingReadings14d, fastingReadings30d, medLogs14d, streak] =
    await Promise.all([
      prisma.glucoseReading.findMany({
        where: { userId, measuredAt: { gte: cutoff14d } },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.glucoseReading.findMany({
        where: { userId, readingType: "fasting", measuredAt: { gte: cutoff14d } },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.glucoseReading.findMany({
        where: { userId, readingType: "fasting", measuredAt: { gte: cutoff30d } },
        select: { valueMgDl: true, measuredAt: true },
      }),
      prisma.medicationLog.findMany({
        where: { userId, createdAt: { gte: cutoff14d } },
        select: { status: true },
      }),
      prisma.userStreak.findUnique({
        where: { userId },
        select: { currentStreakDays: true },
      }),
    ]);

  return {
    allReadingsLast14d: allReadings14d.map((r) => ({
      valueMgDl: r.valueMgDl,
      measuredAt: r.measuredAt.toISOString(),
    })),
    fastingReadingsLast14d: fastingReadings14d.map((r) => ({
      valueMgDl: r.valueMgDl,
      measuredAt: r.measuredAt.toISOString(),
    })),
    fastingReadingsLast30d: fastingReadings30d.map((r) => ({
      valueMgDl: r.valueMgDl,
      measuredAt: r.measuredAt.toISOString(),
    })),
    medicationLogsLast14d: medLogs14d.map((l) => ({ status: l.status })),
    currentStreakDays: streak?.currentStreakDays ?? 0,
    now,
  };
};

export const processDailyHealthScore = async (_job: Job<DailyHealthScoreJob>): Promise<void> => {
  const now = new Date();
  const computedForDate = new Date(now.toISOString().slice(0, 10)); // 00:00 UTC of "today"

  // Onboarded users only — pre-onboarding rows have empty histories and
  // would just produce 50-ish neutral scores.
  const users = await prisma.user.findMany({
    where: { onboardingComplete: true },
    select: { id: true },
  });

  let processed = 0;
  let failures = 0;
  for (const u of users) {
    try {
      const input = await buildInputForUser(u.id, now);
      const result = computeHealthScore(input);
      const componentsJson = result.components as unknown as Prisma.InputJsonValue;
      await prisma.healthScore.upsert({
        where: {
          userId_computedForDate: { userId: u.id, computedForDate },
        },
        create: {
          userId: u.id,
          score: result.score,
          components: componentsJson,
          computedForDate,
        },
        update: {
          score: result.score,
          components: componentsJson,
        },
      });
      // Invalidate the GET cache so the next dashboard fetch sees the
      // fresh score immediately instead of waiting for TTL.
      await redis.del(`health-score:${u.id}`).catch(() => undefined);
      processed += 1;
    } catch (err) {
      failures += 1;
      logger.error({ err, userId: u.id }, "daily health score failed for user");
    }
  }

  logger.info(
    { processed, failures, totalUsers: users.length },
    "daily health score batch complete",
  );
};
