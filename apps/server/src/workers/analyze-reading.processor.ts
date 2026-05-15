// ANALYZE_READING BullMQ processor — fired after every glucose insert.
// Runs all 4 Phase-2 detectors in parallel against the user's recent
// history, then persists every result that returned non-null. Confidence
// below the feed floor (0.7) is still stored — analytics surface — but
// the insights endpoint (step 3a) suppresses it from the patient feed.
//
// Pure-function detectors live in `@swasth/domain-logic/detectors`.
// This processor owns:
//   • the DB reads (recent readings + meals)
//   • the conversion from Prisma rows → `TypedReading` / `MealEntry`
//   • the InsightEvent persistence
// Detectors stay pure (no Prisma import, no Date.now()).

import type { Job } from "bullmq";
import {
  detectAnomaly,
  detectMealCorrelation,
  detectSpike,
  detectTrend,
  type DetectorResult,
  type MealEntry,
  type TypedReading,
} from "@swasth/domain-logic";
import type { GlucoseReadingType, Prisma } from "@prisma/client";

import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";

// 35 days covers anomaly's 21-day requirement plus buffer. Meals only
// matter inside the meal-correlation 7-day window.
const READING_HISTORY_DAYS = 35;
const MEAL_HISTORY_DAYS = 7;
const dayMs = 86_400_000;

export interface AnalyzeReadingJob {
  readingId: string;
  userId: string;
  readingType: GlucoseReadingType;
  // Forwarded from the originating HTTP request so the analyze log line
  // joins the request log under the same requestId.
  requestId?: string;
}

const toTyped = (
  rows: readonly {
    id: string;
    valueMgDl: number;
    readingType: GlucoseReadingType;
    measuredAt: Date;
  }[],
): TypedReading[] =>
  rows.map((r) => ({
    id: r.id,
    valueMgDl: r.valueMgDl,
    readingType: r.readingType,
    measuredAt: r.measuredAt.toISOString(),
  }));

const toMealEntries = (
  rows: readonly {
    id: string;
    mealCategory: MealEntry["mealCategory"];
    loggedAt: Date;
  }[],
): MealEntry[] =>
  rows.map((m) => ({
    id: m.id,
    mealCategory: m.mealCategory,
    loggedAt: m.loggedAt.toISOString(),
  }));

const maxSeverity = (
  results: readonly DetectorResult[],
): DetectorResult["severityLevel"] => {
  let acc: DetectorResult["severityLevel"] = "info";
  for (const r of results) {
    if (r.severityLevel === "critical") return "critical";
    if (r.severityLevel === "warn") acc = "warn";
  }
  return acc;
};

export const processAnalyzeReading = async (
  job: Job<AnalyzeReadingJob>,
): Promise<void> => {
  const { readingId, userId, readingType, requestId } = job.data;
  const childLogger = logger.child({
    queue: "analyze-reading",
    jobId: job.id,
    readingId,
    userId,
    ...(requestId ? { requestId } : {}),
  });

  const now = new Date();
  const readingCutoff = new Date(now.getTime() - READING_HISTORY_DAYS * dayMs);
  const mealCutoff = new Date(now.getTime() - MEAL_HISTORY_DAYS * dayMs);

  const [readings, meals] = await Promise.all([
    prisma.glucoseReading.findMany({
      where: { userId, measuredAt: { gte: readingCutoff } },
      select: { id: true, valueMgDl: true, readingType: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.mealLog.findMany({
      where: { userId, loggedAt: { gte: mealCutoff } },
      select: { id: true, mealCategory: true, loggedAt: true },
      orderBy: { loggedAt: "asc" },
    }),
  ]);

  const typedReadings = toTyped(readings);
  const mealEntries = toMealEntries(meals);

  // All four detectors are synchronous pure functions. Promise.resolve
  // keeps the contract symmetric in case a future detector goes async
  // (e.g. a Claude-assisted cross-condition one).
  const detectorRuns = await Promise.all([
    Promise.resolve(
      detectSpike({
        readings: typedReadings,
        targetReadingId: readingId,
        targetReadingType: readingType,
        now,
      }),
    ),
    Promise.resolve(
      detectTrend({
        readings: typedReadings,
        windowDays: 14,
        targetReadingType: readingType,
        now,
      }),
    ),
    Promise.resolve(
      detectMealCorrelation({
        readings: typedReadings,
        meals: mealEntries,
        now,
      }),
    ),
    Promise.resolve(
      detectAnomaly({
        readings: typedReadings,
        targetReadingId: readingId,
        targetReadingType: readingType,
        now,
      }),
    ),
  ]);

  const results = detectorRuns.filter((r): r is DetectorResult => r !== null);

  if (results.length === 0) {
    childLogger.debug("analyze-reading: no detectors fired");
    return;
  }

  // Bulk-insert all firing detectors. InsightEvent has no unique
  // constraint that could race, so createMany is safe.
  await prisma.insightEvent.createMany({
    data: results.map((r) => ({
      userId,
      patternType: r.patternType,
      conditionsInvolved: [...r.conditionsInvolved],
      severityScore: r.severityScore,
      severityLevel: r.severityLevel,
      messageKey: r.messageKey,
      messageParams: r.messageParams as Prisma.InputJsonValue,
      triggerReadings: [...r.triggerReadings] as Prisma.InputJsonValue,
      evidence: r.evidence as Prisma.InputJsonValue,
      confidence: r.confidence,
    })),
  });

  childLogger.info(
    {
      detectorsFired: results.length,
      patterns: results.map((r) => r.patternType),
      maxSeverity: maxSeverity(results),
    },
    "analyze-reading: insights persisted",
  );
};
