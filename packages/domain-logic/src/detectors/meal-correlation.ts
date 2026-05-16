// Meal-correlation detector — links a meal category (light / normal /
// heavy_fried) to post-meal glucose response. Flags categories whose
// post_meal readings sit meaningfully above the patient's overall
// post_meal baseline.
//
// Spec (CLAUDE.md Insight Engine):
//   • Meal CATEGORY, not specific foods (3-bucket from step 2)
//   • 7-calendar-day window (not "last 7 readings")
//   • Min 5 instances per category for that category to be testable
//   • Min 7 days of data overall
//   • Confidence: anchored on effect size + sample depth
//
// Rule for matching reading → meal:
//   A post_meal reading is attributed to the *most recent meal logged
//   within the prior MEAL_WINDOW_HOURS (3hrs)*. Readings without a
//   matching meal are excluded from the per-category buckets but DO
//   contribute to the "overall post-meal mean" baseline.

import { mean, daysBetween } from "./stats.js";
import type { DetectorResult, MealEntry, TypedReading } from "./types.js";

export interface MealCorrelationDetectorInput {
  readings: readonly TypedReading[];
  meals: readonly MealEntry[];
  now: Date;
}

const dayMs = 86_400_000;
const MEAL_CORRELATION_WINDOW_DAYS = 7;
const MEAL_CORRELATION_MIN_PER_CATEGORY = 5;
const MEAL_WINDOW_HOURS = 3;
const MEAL_WINDOW_MS = MEAL_WINDOW_HOURS * 60 * 60 * 1000;

// Effect-size thresholds in mg/dL above overall post_meal baseline.
// Below 10 → noise (CLAUDE.md "Delta < 10 → always neutral").
const CORRELATION_INFO_DELTA = 10;
const CORRELATION_WARN_DELTA = 25;
const CORRELATION_CRITICAL_DELTA = 50;

interface CategoryStats {
  category: MealEntry["mealCategory"];
  count: number;
  mean: number;
  triggerReadingIds: readonly string[];
}

export const detectMealCorrelation = (
  input: MealCorrelationDetectorInput,
): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - MEAL_CORRELATION_WINDOW_DAYS * dayMs;

  // Only post_meal readings count for this detector — pre_meal and
  // fasting are unrelated to "what did the patient eat".
  const postMealInWindow = input.readings.filter((r) => {
    if (r.readingType !== "post_meal") return false;
    const t = new Date(r.measuredAt).getTime();
    return t >= windowStartMs && t <= nowMs;
  });

  if (postMealInWindow.length < MEAL_CORRELATION_MIN_PER_CATEGORY) {
    // Even the best-case category can't hit min-per-category.
    return null;
  }

  // Span guard: 7-CALENDAR-day window per CLAUDE.md — reject 7
  // readings packed into 24h.
  const oldestMs = Math.min(...postMealInWindow.map((r) => new Date(r.measuredAt).getTime()));
  if (daysBetween(oldestMs, nowMs) < 3) return null;

  const mealsInWindow = input.meals.filter((m) => {
    const t = new Date(m.loggedAt).getTime();
    return t >= windowStartMs - MEAL_WINDOW_MS && t <= nowMs;
  });

  // Index meals by ms timestamp for O(n log n) attribution.
  const sortedMeals = [...mealsInWindow].sort(
    (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
  );

  // Attribute each reading to the most-recent meal within MEAL_WINDOW_MS.
  // Linear scan from newest-meal-backwards is fine at expected scale
  // (≤ 30 meals × ≤ 50 readings = 1500 ops).
  type AttributedReading = TypedReading & {
    mealCategory: MealEntry["mealCategory"];
  };
  const attributed: AttributedReading[] = [];
  for (const reading of postMealInWindow) {
    const readingMs = new Date(reading.measuredAt).getTime();
    let bestMeal: MealEntry | null = null;
    for (let i = sortedMeals.length - 1; i >= 0; i--) {
      const meal = sortedMeals[i];
      if (!meal) continue;
      const mealMs = new Date(meal.loggedAt).getTime();
      if (mealMs > readingMs) continue; // meal is after reading
      if (readingMs - mealMs > MEAL_WINDOW_MS) break; // too old to attribute
      bestMeal = meal;
      break;
    }
    if (bestMeal) {
      attributed.push({ ...reading, mealCategory: bestMeal.mealCategory });
    }
  }

  // Overall post-meal baseline includes *all* post_meal readings in
  // the window, not just attributed ones — gives the most stable mean
  // to compare against.
  const overallMean = mean(postMealInWindow.map((r) => r.valueMgDl));

  const byCategory = new Map<MealEntry["mealCategory"], CategoryStats>();
  for (const cat of ["light", "normal", "heavy_fried"] as const) {
    const matches = attributed.filter((r) => r.mealCategory === cat);
    if (matches.length >= MEAL_CORRELATION_MIN_PER_CATEGORY) {
      byCategory.set(cat, {
        category: cat,
        count: matches.length,
        mean: mean(matches.map((r) => r.valueMgDl)),
        triggerReadingIds: matches.map((r) => r.id),
      });
    }
  }

  if (byCategory.size === 0) return null;

  // Pick the category with the largest delta vs overall baseline.
  // We're surfacing "this meal type spikes you" — only one card per
  // run; the detector re-runs on every new reading.
  let worst: CategoryStats | null = null;
  let worstDelta = -Infinity;
  for (const stats of byCategory.values()) {
    const delta = stats.mean - overallMean;
    if (delta > worstDelta) {
      worst = stats;
      worstDelta = delta;
    }
  }

  if (!worst || worstDelta < CORRELATION_INFO_DELTA) return null;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (worstDelta >= CORRELATION_CRITICAL_DELTA) {
    severityLevel = "critical";
    severityScore = 80;
    messageKey = "insight.meal_correlation.critical";
  } else if (worstDelta >= CORRELATION_WARN_DELTA) {
    severityLevel = "warn";
    severityScore = 60;
    messageKey = "insight.meal_correlation.warn";
  } else {
    severityLevel = "info";
    severityScore = 40;
    messageKey = "insight.meal_correlation.info";
  }

  // Confidence: effect size (delta) + sample depth in the picked
  // category. Heavy_fried with 8+ samples at +60 mg/dL clears 0.7
  // comfortably; light with exactly 5 samples at +12 mg/dL stays
  // below the feed floor.
  const sampleDepth = Math.min(1, worst.count / 10);
  const effectScale = Math.min(1, worstDelta / CORRELATION_CRITICAL_DELTA);
  const confidence = Math.min(1, 0.4 + 0.3 * sampleDepth + 0.3 * effectScale);

  return {
    patternType: "meal_correlation",
    conditionsInvolved: ["glucose", "meal"],
    severityScore,
    severityLevel,
    messageKey,
    messageParams: {
      mealCategory: worst.category,
      categoryMean: Math.round(worst.mean),
      overallMean: Math.round(overallMean),
      delta: Math.round(worstDelta),
    },
    triggerReadings: worst.triggerReadingIds,
    evidence: {
      mealCategory: worst.category,
      categoryCount: worst.count,
      categoryMean: Math.round(worst.mean * 10) / 10,
      overallMean: Math.round(overallMean * 10) / 10,
      delta: Math.round(worstDelta * 10) / 10,
      windowDays: MEAL_CORRELATION_WINDOW_DAYS,
      mealWindowHours: MEAL_WINDOW_HOURS,
    },
    confidence,
  };
};
