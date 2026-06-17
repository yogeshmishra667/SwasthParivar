// Meal-category correlation detector (phase3.md B.1 #2).
//
// Links a meal category (light / normal / heavy_fried) to the glucose
// response — computed SEPARATELY PER READING TYPE. A category's fasting
// readings are only ever compared against the fasting baseline,
// post_meal against post_meal, etc. (CLAUDE.md "ALWAYS compare same
// reading type … never mix"). Festive-tagged readings are excluded — a
// Diwali sweet is not a dietary pattern.
//
// vs. the Phase 2 `detectMealCorrelation` (post_meal-only, fixed
// window): this generalises it — per-reading-type, festive-aware, and
// with a configurable window / min-instances. The Phase 2 detector is
// left untouched; the service layer (phase3.md B.2) chooses which runs.
//
// Pure, IO-free; `now` is a parameter — never `new Date()` here.

import { mean, daysBetween } from "./stats.js";
import type { DetectorResult, MealEntry, TypedReading } from "./types.js";

export interface MealCategoryCorrelationInput {
  glucoseReadings: readonly TypedReading[];
  mealLogs: readonly MealEntry[];
  now: Date;
  /** Calendar-day rolling window (default 7). */
  windowDays?: number;
  /** Minimum same-(type, category) readings for a bucket (default 5). */
  minInstances?: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_INSTANCES = 5;
// A reading is attributed to the most recent meal logged ≤ 3h before it.
const ATTRIBUTION_WINDOW_MS = 3 * 60 * 60 * 1000;
// Reject N readings crammed into < 3 calendar days — that is not a
// rolling-window pattern (CLAUDE.md "7-calendar-day window").
const MIN_SPAN_DAYS = 3;

// Effect-size thresholds: mg/dL above the same-reading-type baseline.
// Below INFO_DELTA is noise (CLAUDE.md "Delta < 10 → always neutral").
const INFO_DELTA = 10;
const WARN_DELTA = 25;
const CRITICAL_DELTA = 50;

type MealCategory = MealEntry["mealCategory"];
type ReadingType = TypedReading["readingType"];
const CATEGORIES: readonly MealCategory[] = ["light", "normal", "heavy_fried"];

interface BucketStats {
  readingType: ReadingType;
  category: MealCategory;
  count: number;
  categoryMean: number;
  baseline: number;
  delta: number;
  readingIds: string[];
}

// Phase 4 §H — a food-item bucket. Mirrors BucketStats but keyed on a
// specific IndianFoodItem rather than the coarse 3-bucket category.
interface FoodBucketStats {
  readingType: ReadingType;
  foodItemId: string;
  foodName: string;
  count: number;
  foodMean: number;
  baseline: number;
  delta: number;
  readingIds: string[];
}

export const detectMealCategoryCorrelation = (
  input: MealCategoryCorrelationInput,
): DetectorResult | null => {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minInstances = input.minInstances ?? DEFAULT_MIN_INSTANCES;
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - windowDays * DAY_MS;

  // In-window, non-festive glucose readings.
  const inWindow = input.glucoseReadings.filter((r) => {
    if (r.context === "festive") return false;
    const t = new Date(r.measuredAt).getTime();
    return t >= windowStartMs && t <= nowMs;
  });
  if (inWindow.length < minInstances) return null;

  // Span guard — a real calendar window, not N readings in one day.
  const oldestMs = Math.min(...inWindow.map((r) => new Date(r.measuredAt).getTime()));
  if (daysBetween(oldestMs, nowMs) < MIN_SPAN_DAYS) return null;

  // Per-reading-type baseline — the mean of ALL in-window readings of
  // that type. Keyed by type so a category effect is never measured
  // against a mixed-type mean.
  const byType = new Map<ReadingType, TypedReading[]>();
  for (const r of inWindow) {
    const arr = byType.get(r.readingType) ?? [];
    arr.push(r);
    byType.set(r.readingType, arr);
  }

  // Attribute each reading to the most recent meal ≤ 3h before it.
  // Meals are walked newest-first so the first in-window hit wins.
  // §H: the food link is carried only when BOTH id and display name are
  // present — the id groups, the name renders. A meal with one but not
  // the other still contributes its category, just not a food bucket.
  const mealsNewestFirst = [...input.mealLogs]
    .map((m) => ({
      category: m.mealCategory,
      foodItemId: m.foodItemId,
      foodName: m.foodName,
      ms: new Date(m.loggedAt).getTime(),
    }))
    .sort((a, b) => b.ms - a.ms);
  const categoryOf = new Map<string, MealCategory>();
  // readingId → attributed food (id + display name). Both are stored
  // together so the bucket always has a name without a second lookup.
  const foodOf = new Map<string, { id: string; name: string }>();
  for (const reading of inWindow) {
    const readingMs = new Date(reading.measuredAt).getTime();
    for (const entry of mealsNewestFirst) {
      if (entry.ms > readingMs) continue;
      if (readingMs - entry.ms > ATTRIBUTION_WINDOW_MS) break;
      categoryOf.set(reading.id, entry.category);
      if (entry.foodItemId !== undefined && entry.foodName !== undefined) {
        foodOf.set(reading.id, { id: entry.foodItemId, name: entry.foodName });
      }
      break;
    }
  }

  // Bucket by (readingType, category); pick the largest upward delta.
  let worstCategory: BucketStats | null = null;
  // §H: also bucket by (readingType, foodItemId) for a finer pattern.
  let worstFood: FoodBucketStats | null = null;
  for (const [type, readings] of byType) {
    const baseline = mean(readings.map((r) => r.valueMgDl));
    for (const category of CATEGORIES) {
      const bucket = readings.filter((r) => categoryOf.get(r.id) === category);
      if (bucket.length < minInstances) continue;
      const categoryMean = mean(bucket.map((r) => r.valueMgDl));
      const delta = categoryMean - baseline;
      if (worstCategory === null || delta > worstCategory.delta) {
        worstCategory = {
          readingType: type,
          category,
          count: bucket.length,
          categoryMean,
          baseline,
          delta,
          readingIds: bucket.map((r) => r.id),
        };
      }
    }

    // Food-item buckets within this reading type.
    const byFood = new Map<string, { name: string; readings: TypedReading[] }>();
    for (const r of readings) {
      const food = foodOf.get(r.id);
      if (food === undefined) continue;
      const arr = byFood.get(food.id) ?? { name: food.name, readings: [] };
      arr.readings.push(r);
      byFood.set(food.id, arr);
    }
    for (const [fid, { name, readings: bucket }] of byFood) {
      if (bucket.length < minInstances) continue;
      const foodMean = mean(bucket.map((r) => r.valueMgDl));
      const delta = foodMean - baseline;
      if (worstFood === null || delta > worstFood.delta) {
        worstFood = {
          readingType: type,
          foodItemId: fid,
          foodName: name,
          count: bucket.length,
          foodMean,
          baseline,
          delta,
          readingIds: bucket.map((r) => r.id),
        };
      }
    }
  }

  // §H precedence: a qualifying food-item pattern is more actionable
  // than the coarse category one, so it wins when it clears the noise
  // floor. Otherwise fall back to the category pattern (existing
  // behaviour — when no foodItemId is supplied, worstFood is always
  // null and this is a no-op).
  const foodQualifies = worstFood !== null && worstFood.delta >= INFO_DELTA;
  const categoryQualifies = worstCategory !== null && worstCategory.delta >= INFO_DELTA;
  if (!foodQualifies && !categoryQualifies) return null;

  const winnerDelta = foodQualifies ? worstFood!.delta : worstCategory!.delta;
  const winnerCount = foodQualifies ? worstFood!.count : worstCategory!.count;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  if (winnerDelta >= CRITICAL_DELTA) {
    severityLevel = "critical";
    severityScore = 80;
  } else if (winnerDelta >= WARN_DELTA) {
    severityLevel = "warn";
    severityScore = 60;
  } else {
    severityLevel = "info";
    severityScore = 40;
  }

  // Confidence blends sample depth and effect size. No floor here —
  // CLAUDE.md's "<70% → stored only" is applied by the service layer,
  // matching the Phase 2 meal-correlation detector.
  const sampleDepth = Math.min(1, winnerCount / 10);
  const effectScale = Math.min(1, winnerDelta / CRITICAL_DELTA);
  const confidence = Math.min(1, 0.4 + 0.3 * sampleDepth + 0.3 * effectScale);

  if (foodQualifies) {
    const w = worstFood!;
    return {
      patternType: "meal_correlation",
      conditionsInvolved: ["glucose", "meal"],
      severityScore,
      severityLevel,
      messageKey: `insight.meal_correlation.food.${severityLevel}`,
      messageParams: {
        foodName: w.foodName,
        foodItemId: w.foodItemId,
        readingType: w.readingType,
        foodMean: Math.round(w.foodMean),
        baseline: Math.round(w.baseline),
        delta: Math.round(w.delta),
      },
      triggerReadings: w.readingIds,
      evidence: {
        foodItemId: w.foodItemId,
        foodName: w.foodName,
        readingType: w.readingType,
        count: w.count,
        foodMean: Math.round(w.foodMean * 10) / 10,
        baseline: Math.round(w.baseline * 10) / 10,
        delta: Math.round(w.delta * 10) / 10,
        windowDays,
      },
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  const w = worstCategory!;
  return {
    patternType: "meal_correlation",
    conditionsInvolved: ["glucose", "meal"],
    severityScore,
    severityLevel,
    messageKey: `insight.meal_correlation.${severityLevel}`,
    messageParams: {
      mealCategory: w.category,
      readingType: w.readingType,
      categoryMean: Math.round(w.categoryMean),
      baseline: Math.round(w.baseline),
      delta: Math.round(w.delta),
    },
    triggerReadings: w.readingIds,
    evidence: {
      mealCategory: w.category,
      readingType: w.readingType,
      count: w.count,
      categoryMean: Math.round(w.categoryMean * 10) / 10,
      baseline: Math.round(w.baseline * 10) / 10,
      delta: Math.round(w.delta * 10) / 10,
      windowDays,
    },
    confidence: Math.round(confidence * 100) / 100,
  };
};
