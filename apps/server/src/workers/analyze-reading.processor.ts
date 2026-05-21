// ANALYZE_READING BullMQ processor — fired after every glucose insert.
// Runs the detector suite in parallel against the user's recent history,
// then persists every result that returned non-null. Confidence below
// the feed floor (0.7) is still stored — analytics surface — but the
// insights endpoint (step 3a) suppresses it from the patient feed.
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
  detectCrossCondition,
  detectMealCategoryCorrelation,
  detectMealCorrelation,
  detectSpike,
  detectTrend,
  type DetectorResult,
  type MealEntry,
  type TypedBPReading,
  type TypedReading,
} from "@swasth/domain-logic";
import type { GlucoseReadingType, Prisma } from "@prisma/client";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";

// 35 days covers anomaly's 21-day requirement plus buffer. Meals only
// matter inside the meal-correlation 7-day window.
const READING_HISTORY_DAYS = 35;
const MEAL_HISTORY_DAYS = 7;
const dayMs = 86_400_000;

// Window-level detector patterns: their result is a function of the
// recent-history window alone, not of the reading that triggered the
// job, so they recompute an identical result on every glucose insert.
// The processor dedupes these before persisting (see below). spike and
// anomaly are deliberately excluded — they are keyed to the target
// reading and a fresh occurrence is genuinely new.
const WINDOW_PATTERNS = ["cross_condition", "meal_correlation"] as const;
const isWindowPattern = (pattern: string): boolean =>
  (WINDOW_PATTERNS as readonly string[]).includes(pattern);

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
    context: string | null;
  }[],
): TypedReading[] =>
  rows.map((r) => ({
    id: r.id,
    valueMgDl: r.valueMgDl,
    readingType: r.readingType,
    measuredAt: r.measuredAt.toISOString(),
    ...(r.context === "festive" ? { context: "festive" as const } : {}),
  }));

const toTypedBP = (
  rows: readonly {
    id: string;
    systolic: number;
    diastolic: number;
    measuredAt: Date;
  }[],
): TypedBPReading[] =>
  rows.map((r) => ({
    id: r.id,
    systolic: r.systolic,
    diastolic: r.diastolic,
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

const maxSeverity = (results: readonly DetectorResult[]): DetectorResult["severityLevel"] => {
  let acc: DetectorResult["severityLevel"] = "info";
  for (const r of results) {
    if (r.severityLevel === "critical") return "critical";
    if (r.severityLevel === "warn") acc = "warn";
  }
  return acc;
};

export const processAnalyzeReading = async (job: Job<AnalyzeReadingJob>): Promise<void> => {
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

  const [crossCondEnabled, correlationEnabled] = await Promise.all([
    getFlag<boolean>("cross_condition_detector_enabled", false),
    getFlag<boolean>("correlation_detector_enabled", false),
  ]);

  const [readings, meals, bpReadings] = await Promise.all([
    prisma.glucoseReading.findMany({
      where: { userId, measuredAt: { gte: readingCutoff } },
      select: { id: true, valueMgDl: true, readingType: true, measuredAt: true, context: true },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.mealLog.findMany({
      where: { userId, loggedAt: { gte: mealCutoff } },
      select: { id: true, mealCategory: true, loggedAt: true },
      orderBy: { loggedAt: "asc" },
    }),
    crossCondEnabled
      ? prisma.bPReading.findMany({
          where: { userId, measuredAt: { gte: readingCutoff } },
          select: { id: true, systolic: true, diastolic: true, measuredAt: true },
          orderBy: { measuredAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const typedReadings = toTyped(readings);
  const mealEntries = toMealEntries(meals);
  const typedBP = toTypedBP(bpReadings);

  // All detectors are synchronous pure functions. Promise.resolve keeps
  // the contract symmetric. `cross_condition_detector_enabled` gates the
  // Phase 3 cross-condition detector. `correlation_detector_enabled`
  // SWITCHES the meal slot from the Phase 2 detector to the Phase 3
  // per-reading-type one — both emit the `meal_correlation` pattern, so
  // running them together would persist two duplicate insight cards.
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
    correlationEnabled
      ? Promise.resolve(
          detectMealCategoryCorrelation({
            glucoseReadings: typedReadings,
            mealLogs: mealEntries,
            now,
          }),
        )
      : Promise.resolve(
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
    crossCondEnabled
      ? Promise.resolve(
          detectCrossCondition({
            glucoseReadings: typedReadings,
            bpReadings: typedBP,
            now,
          }),
        )
      : Promise.resolve(null),
  ]);

  const results = detectorRuns.filter((r): r is DetectorResult => r !== null);

  if (results.length === 0) {
    childLogger.debug("analyze-reading: no detectors fired");
    return;
  }

  // Window-level patterns (cross_condition, meal_correlation) recompute
  // an identical result on every glucose insert, and the job re-runs
  // wholesale on a BullMQ retry — without a guard the feed fills with
  // duplicate cards. Drop a window-pattern result when an unacknowledged
  // row of the same pattern already exists from the last 24h with
  // equal-or-higher severity; a genuine severity escalation still gets
  // through. Target-keyed patterns (spike, anomaly) are never deduped.
  let toInsert = results;
  if (results.some((r) => isWindowPattern(r.patternType))) {
    const recent = await prisma.insightEvent.findMany({
      where: {
        userId,
        acknowledged: false,
        patternType: { in: [...WINDOW_PATTERNS] },
        createdAt: { gte: new Date(now.getTime() - dayMs) },
      },
      select: { patternType: true, severityScore: true },
    });
    toInsert = results.filter((r) => {
      if (!isWindowPattern(r.patternType)) return true;
      const superseded = recent.some(
        (e) => e.patternType === r.patternType && e.severityScore >= r.severityScore,
      );
      return !superseded;
    });
  }

  if (toInsert.length === 0) {
    childLogger.debug("analyze-reading: window patterns already current — nothing persisted");
    return;
  }

  // Bulk-insert the surviving detector results.
  await prisma.insightEvent.createMany({
    data: toInsert.map((r) => ({
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
      detectorsFired: toInsert.length,
      patterns: toInsert.map((r) => r.patternType),
      maxSeverity: maxSeverity(toInsert),
    },
    "analyze-reading: insights persisted",
  );
};
