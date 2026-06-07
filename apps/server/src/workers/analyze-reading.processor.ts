// ANALYZE_READING BullMQ processor — fired after every reading insert.
//
// Phase 1 (glucose): runs the original detector suite — spike, trend,
//   meal-correlation, anomaly, cross-condition.
// Phase 4 (multi-condition, Feature E follow-up):
//   - bp: runs cross-condition so a BP-only patient still gets the
//     glucose↔BP correlation fired when BP arrives (previously only
//     fired on glucose insert, leaving the path stale for a guardian
//     watching a BP-leading patient).
//   - cardiac: runs detectCardiacTrend across 5/14/30 day windows.
//   - respiratory: runs detectRespiratoryTrend across 5/14/30 day
//     windows.
//
// Pure-function detectors live in `@swasth/domain-logic/detectors`.
// This processor owns:
//   • the DB reads (recent readings + meals)
//   • the conversion from Prisma rows → `Typed*Reading` / `MealEntry`
//   • the InsightEvent persistence
// Detectors stay pure (no Prisma import, no Date.now()).
//
// Job-shape evolution: `category` is the discriminator. A legacy in-
// flight job (mid-deploy) that lacks `category` is treated as glucose
// — back-compat is required because BullMQ may have queued jobs from
// the previous server version.

import type { Job } from "bullmq";
import {
  detectAnomaly,
  detectCardiacTrend,
  detectCrossCondition,
  detectMealCategoryCorrelation,
  detectMealCorrelation,
  detectRespiratoryTrend,
  detectSpike,
  detectTrend,
  type DetectorResult,
  type MealEntry,
  type TypedBPReading,
  type TypedCardiacReading,
  type TypedReading,
  type TypedRespiratoryReading,
} from "@swasth/domain-logic";
import type { GlucoseReadingType, Prisma } from "@prisma/client";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";

// 35 days covers anomaly's 21-day requirement plus buffer. Meals only
// matter inside the meal-correlation 7-day window. Trend windows
// (cardiac/respiratory) max out at 30 days, comfortably inside the 35.
const READING_HISTORY_DAYS = 35;
const MEAL_HISTORY_DAYS = 7;
const dayMs = 86_400_000;

// Window-level detector patterns: their result is a function of the
// recent-history window alone, not of the reading that triggered the
// job, so they recompute an identical result on every insert in their
// category. The processor dedupes these before persisting. spike and
// anomaly are deliberately excluded — they are keyed to the target
// reading and a fresh occurrence is genuinely new. `trend` is also
// window-level: re-firing on every reading would flood the feed.
const WINDOW_PATTERNS = ["cross_condition", "meal_correlation", "trend"] as const;
const isWindowPattern = (pattern: string): boolean =>
  (WINDOW_PATTERNS as readonly string[]).includes(pattern);

// ─────────────────────────────────────────────────────────────
// Job shape (discriminated union — `category` is the discriminator)
// ─────────────────────────────────────────────────────────────

/**
 * Legacy / glucose shape. Phase 1 jobs carried no `category` field;
 * a missing discriminator routes here for back-compat with in-flight
 * BullMQ jobs from the previous server version.
 */
export interface AnalyzeGlucoseJob {
  category?: "glucose";
  readingId: string;
  userId: string;
  readingType: GlucoseReadingType;
  requestId?: string;
}

export interface AnalyzeBPJob {
  category: "bp";
  readingId: string;
  userId: string;
  requestId?: string;
}

export interface AnalyzeCardiacJob {
  category: "cardiac";
  readingId: string;
  userId: string;
  requestId?: string;
}

export interface AnalyzeRespiratoryJob {
  category: "respiratory";
  readingId: string;
  userId: string;
  requestId?: string;
}

export type AnalyzeReadingJob =
  | AnalyzeGlucoseJob
  | AnalyzeBPJob
  | AnalyzeCardiacJob
  | AnalyzeRespiratoryJob;

// ─────────────────────────────────────────────────────────────
// Row → pure-typed shape mappers
// ─────────────────────────────────────────────────────────────

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

const toTypedCardiac = (
  rows: readonly {
    id: string;
    heartRate: number;
    measuredAt: Date;
  }[],
): TypedCardiacReading[] =>
  rows.map((r) => ({
    id: r.id,
    heartRateBpm: r.heartRate,
    measuredAt: r.measuredAt.toISOString(),
  }));

const toTypedRespiratory = (
  rows: readonly {
    id: string;
    peakFlow: number | null;
    measuredAt: Date;
  }[],
): TypedRespiratoryReading[] =>
  rows
    // Detector input forbids null peakFlow — service filter responsibility
    // lives here at the boundary, mirroring how `toTyped()` strips the
    // festive context.
    .filter((r): r is { id: string; peakFlow: number; measuredAt: Date } => r.peakFlow !== null)
    .map((r) => ({
      id: r.id,
      peakFlow: r.peakFlow,
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

// ─────────────────────────────────────────────────────────────
// Per-category detector runners (pure orchestration; DB reads above)
// ─────────────────────────────────────────────────────────────

const runGlucoseDetectors = async (
  data: AnalyzeGlucoseJob,
  now: Date,
  readingCutoff: Date,
  mealCutoff: Date,
): Promise<readonly DetectorResult[]> => {
  const { readingId, userId, readingType } = data;

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

  return detectorRuns.filter((r): r is DetectorResult => r !== null);
};

const runBPDetectors = async (
  data: AnalyzeBPJob,
  now: Date,
  readingCutoff: Date,
): Promise<readonly DetectorResult[]> => {
  const { userId } = data;

  // BP path runs cross-condition so a BP-only insert still fires the
  // glucose↔BP correlation card (gap: previously only fired on glucose
  // insert, so a BP-leading patient never produced cross-condition
  // signal). Same flag gate as the glucose path — disable in dev
  // dropping zero coverage.
  const crossCondEnabled = await getFlag<boolean>("cross_condition_detector_enabled", false);
  if (!crossCondEnabled) return [];

  const [glucoseReadings, bpReadings] = await Promise.all([
    prisma.glucoseReading.findMany({
      where: { userId, measuredAt: { gte: readingCutoff } },
      select: { id: true, valueMgDl: true, readingType: true, measuredAt: true, context: true },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.bPReading.findMany({
      where: { userId, measuredAt: { gte: readingCutoff } },
      select: { id: true, systolic: true, diastolic: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    }),
  ]);

  const result = detectCrossCondition({
    glucoseReadings: toTyped(glucoseReadings),
    bpReadings: toTypedBP(bpReadings),
    now,
  });
  return result === null ? [] : [result];
};

const runCardiacDetectors = async (
  data: AnalyzeCardiacJob,
  now: Date,
  readingCutoff: Date,
): Promise<readonly DetectorResult[]> => {
  const { userId } = data;

  const rows = await prisma.cardiacLog.findMany({
    where: { userId, measuredAt: { gte: readingCutoff } },
    select: { id: true, heartRate: true, measuredAt: true },
    orderBy: { measuredAt: "asc" },
  });
  const typed = toTypedCardiac(rows);

  // Three window widths so a 5-day fast-developing trend (medication
  // changeover) lands separately from a 30-day slow drift. Same shape
  // as the glucose-trend job-time emit (windowDays=14) but extended
  // across all three windows because cardiac trend is the only detector
  // running for this category, so the marginal cost is one extra
  // pure-function call per window. The de-dup pass below collapses
  // duplicate (patternType + windowDays) at write time.
  const runs = [5, 14, 30].map((windowDays) =>
    detectCardiacTrend({ readings: typed, windowDays: windowDays as 5 | 14 | 30, now }),
  );
  return runs.filter((r): r is DetectorResult => r !== null);
};

const runRespiratoryDetectors = async (
  data: AnalyzeRespiratoryJob,
  now: Date,
  readingCutoff: Date,
): Promise<readonly DetectorResult[]> => {
  const { userId } = data;

  const rows = await prisma.respiratoryLog.findMany({
    where: { userId, measuredAt: { gte: readingCutoff } },
    select: { id: true, peakFlow: true, measuredAt: true },
    orderBy: { measuredAt: "asc" },
  });
  const typed = toTypedRespiratory(rows);

  const runs = [5, 14, 30].map((windowDays) =>
    detectRespiratoryTrend({ readings: typed, windowDays: windowDays as 5 | 14 | 30, now }),
  );
  return runs.filter((r): r is DetectorResult => r !== null);
};

const dispatchDetectors = async (
  data: AnalyzeReadingJob,
  now: Date,
  readingCutoff: Date,
  mealCutoff: Date,
): Promise<readonly DetectorResult[]> => {
  // Discriminate on category; missing category = legacy glucose job
  // (back-compat with in-flight BullMQ retries from the previous server).
  if (data.category === "bp") return await runBPDetectors(data, now, readingCutoff);
  if (data.category === "cardiac") return await runCardiacDetectors(data, now, readingCutoff);
  if (data.category === "respiratory")
    return await runRespiratoryDetectors(data, now, readingCutoff);
  return await runGlucoseDetectors(data, now, readingCutoff, mealCutoff);
};

// ─────────────────────────────────────────────────────────────
// Processor entry point
// ─────────────────────────────────────────────────────────────

export const processAnalyzeReading = async (job: Job<AnalyzeReadingJob>): Promise<void> => {
  const data = job.data;
  const { readingId, userId, requestId } = data;
  const category = data.category ?? "glucose";

  const childLogger = logger.child({
    queue: "analyze-reading",
    jobId: job.id,
    readingId,
    userId,
    category,
    ...(requestId ? { requestId } : {}),
  });

  const now = new Date();
  const readingCutoff = new Date(now.getTime() - READING_HISTORY_DAYS * dayMs);
  const mealCutoff = new Date(now.getTime() - MEAL_HISTORY_DAYS * dayMs);

  const results = await dispatchDetectors(data, now, readingCutoff, mealCutoff);

  if (results.length === 0) {
    childLogger.debug("analyze-reading: no detectors fired");
    return;
  }

  // Window-level patterns recompute an identical result on every insert,
  // and the job re-runs wholesale on a BullMQ retry — without a guard
  // the feed fills with duplicates. Drop a window-pattern result when an
  // unacknowledged row of the same pattern already exists from the last
  // 24h with equal-or-higher severity; a genuine severity escalation
  // still gets through. Target-keyed patterns (spike, anomaly) are
  // never deduped.
  let toInsert: readonly DetectorResult[] = results;
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
