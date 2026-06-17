import { describe, expect, it } from "vitest";
import {
  detectMealCategoryCorrelation,
  type MealCategoryCorrelationInput,
} from "./correlation-meal.js";
import type { MealEntry, TypedReading } from "./types.js";

const DAY = 86_400_000;
const NOW = new Date("2026-05-08T18:00:00Z");

// ISO timestamp for `dayOffset` days before NOW, at `hour` UTC.
const at = (dayOffset: number, hour: number): string => {
  const d = new Date(NOW.getTime() - dayOffset * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

interface RSpec {
  day: number;
  hour: number;
  value: number;
  type?: TypedReading["readingType"];
  context?: "festive" | "normal";
  mealCategory?: MealEntry["mealCategory"];
  // §H — optional food-item link carried on the emitted meal.
  foodItemId?: string;
  foodName?: string;
}

// Builds the detector input from reading specs. A spec with a
// `mealCategory` also emits a meal logged 2h before the reading (inside
// the 3h attribution window). `foodItemId`/`foodName` attach the §H
// food link to that meal.
const build = (specs: readonly RSpec[]): MealCategoryCorrelationInput => {
  const glucoseReadings: TypedReading[] = [];
  const mealLogs: MealEntry[] = [];
  specs.forEach((s, i) => {
    glucoseReadings.push({
      id: `g${i}`,
      valueMgDl: s.value,
      readingType: s.type ?? "fasting",
      measuredAt: at(s.day, s.hour),
      ...(s.context ? { context: s.context } : {}),
    });
    if (s.mealCategory !== undefined) {
      mealLogs.push({
        id: `m${i}`,
        mealCategory: s.mealCategory,
        loggedAt: at(s.day, s.hour - 2),
        ...(s.foodItemId !== undefined ? { foodItemId: s.foodItemId } : {}),
        ...(s.foodName !== undefined ? { foodName: s.foodName } : {}),
      });
    }
  });
  return { now: NOW, glucoseReadings, mealLogs };
};

const rep = <T>(n: number, fn: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fn(i));

describe("detectMealCategoryCorrelation", () => {
  it("compares fasting against the fasting baseline only — never mixes reading types", () => {
    const input = build([
      // 6 fasting readings @180, each attributed to a heavy_fried meal.
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 8,
        value: 180,
        type: "fasting" as const,
        mealCategory: "heavy_fried" as const,
      })),
      // 5 fasting readings @120, unattributed → fasting baseline ≈ 153.
      ...rep(5, (i) => ({ day: i + 1, hour: 14, value: 120, type: "fasting" as const })),
      // 8 post_meal readings @250 — if the baseline mixed types it would
      // be pulled to ~194; the assertion below proves it does not.
      ...rep(8, (i) => ({ day: (i % 6) + 1, hour: 20, value: 250, type: "post_meal" as const })),
    ]);
    const result = detectMealCategoryCorrelation(input);
    expect(result).not.toBeNull();
    const evidence = result?.evidence as {
      readingType: string;
      mealCategory: string;
      baseline: number;
    };
    expect(evidence.readingType).toBe("fasting");
    expect(evidence.mealCategory).toBe("heavy_fried");
    // Fasting-only baseline ≈ 153 — decisively below a mixed-type ~194.
    expect(evidence.baseline).toBeLessThan(165);
    expect(result?.severityLevel).toBe("warn");
  });

  it("returns null when the data spans fewer than 3 calendar days", () => {
    const input = build([
      ...rep(3, () => ({ day: 1, hour: 8, value: 200, mealCategory: "heavy_fried" as const })),
      ...rep(3, () => ({ day: 2, hour: 8, value: 200, mealCategory: "heavy_fried" as const })),
    ]);
    expect(detectMealCategoryCorrelation(input)).toBeNull();
  });

  it("enforces the minimum-instances floor per (type, category) bucket", () => {
    const input = build([
      // Only 4 heavy_fried-attributed readings — below the default 5.
      ...rep(4, (i) => ({
        day: i + 1,
        hour: 8,
        value: 200,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(4, (i) => ({ day: i + 1, hour: 14, value: 110 })),
    ]);
    expect(detectMealCategoryCorrelation(input)).toBeNull();
  });

  it("excludes festive-tagged readings from the buckets", () => {
    const base = [
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 8,
        value: 170,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(6, (i) => ({ day: i + 1, hour: 14, value: 120 })),
    ];
    const withFestive = build([
      ...base,
      // A festive 400 mg/dL heavy_fried reading — must NOT inflate the bucket.
      {
        day: 2,
        hour: 9,
        value: 400,
        context: "festive" as const,
        mealCategory: "heavy_fried" as const,
      },
    ]);
    const result = detectMealCategoryCorrelation(withFestive);
    expect(result).not.toBeNull();
    // 6 (not 7) readings in the bucket; the 400 is gone.
    expect((result?.evidence as { count: number }).count).toBe(6);
    expect(result?.triggerReadings).not.toContain("g12");
  });

  it("flags the worst meal category with critical severity for a large lift", () => {
    // 6 heavy_fried @230 vs 6 plain @110 → baseline 170, delta 60 ≥ 50.
    // (The baseline includes the bucket, so delta = (V - P) / 2.)
    const input = build([
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 8,
        value: 230,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(6, (i) => ({ day: i + 1, hour: 14, value: 110 })),
    ]);
    const result = detectMealCategoryCorrelation(input);
    expect(result?.patternType).toBe("meal_correlation");
    expect(result?.conditionsInvolved).toEqual(["glucose", "meal"]);
    expect(result?.severityLevel).toBe("critical"); // delta ≈ 60 ≥ 50
    expect(result?.triggerReadings.length).toBe(6);
  });

  it("reports info severity for a modest meal-category lift", () => {
    // 6 heavy_fried @160 vs 6 plain @130 → baseline 145, delta 15.
    const input = build([
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 8,
        value: 160,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(6, (i) => ({ day: i + 1, hour: 14, value: 130 })),
    ]);
    expect(detectMealCategoryCorrelation(input)?.severityLevel).toBe("info");
  });

  it("returns null when there are no meals to attribute readings to", () => {
    const input = build(rep(8, (i) => ({ day: i + 1, hour: 8, value: 200 })));
    expect(detectMealCategoryCorrelation(input)).toBeNull();
  });

  it("returns null when every category sits within the noise floor", () => {
    // heavy_fried attributed, but only ~5 mg/dL above baseline.
    const input = build([
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 8,
        value: 132,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(6, (i) => ({ day: i + 1, hour: 14, value: 125 })),
    ]);
    expect(detectMealCategoryCorrelation(input)).toBeNull();
  });

  it("picks the worst of multiple qualifying categories, ignoring out-of-window readings", () => {
    // All 18 fasting → baseline ≈ 163. light −33, normal +37, heavy_fried −3.
    const input = build([
      ...rep(6, (i) => ({ day: i + 1, hour: 8, value: 130, mealCategory: "light" as const })),
      ...rep(6, (i) => ({ day: i + 1, hour: 12, value: 200, mealCategory: "normal" as const })),
      ...rep(6, (i) => ({
        day: i + 1,
        hour: 16,
        value: 160,
        mealCategory: "heavy_fried" as const,
      })),
      // 20 days ago — outside the 7-day window, must be excluded.
      { day: 20, hour: 8, value: 999, mealCategory: "heavy_fried" as const },
    ]);
    const result = detectMealCategoryCorrelation(input);
    expect((result?.evidence as { mealCategory: string }).mealCategory).toBe("normal");
    expect(result?.severityLevel).toBe("warn");
  });

  it("honours a custom minInstances", () => {
    const specs = [
      ...rep(3, (i) => ({
        day: i + 1,
        hour: 8,
        value: 200,
        mealCategory: "heavy_fried" as const,
      })),
      ...rep(3, (i) => ({ day: i + 1, hour: 14, value: 120 })),
    ];
    // Default (5) → null; explicit minInstances 3 + windowDays 7 → fires.
    expect(detectMealCategoryCorrelation(build(specs))).toBeNull();
    expect(
      detectMealCategoryCorrelation({ ...build(specs), minInstances: 3, windowDays: 7 }),
    ).not.toBeNull();
  });

  // ───────────────────────────────────────────────────────────
  // Phase 4 §H — food-item grouping mode
  // ───────────────────────────────────────────────────────────
  describe("food-item mode (§H)", () => {
    interface FoodResult {
      foodItemId: string;
      foodName: string;
      readingType: string;
    }

    it("surfaces a food-specific pattern that takes precedence over category", () => {
      const input = build([
        // 6 post_meal @220 after "Aloo paratha" (heavy_fried, linked).
        ...rep(6, (i) => ({
          day: i + 1,
          hour: 13,
          value: 220,
          type: "post_meal" as const,
          mealCategory: "heavy_fried" as const,
          foodItemId: "f1",
          foodName: "Aloo paratha",
        })),
        // 6 unattributed post_meal @140 → baseline ≈ 180, food delta ≈ 40.
        ...rep(6, (i) => ({ day: i + 1, hour: 19, value: 140, type: "post_meal" as const })),
      ]);
      const result = detectMealCategoryCorrelation(input);
      expect(result).not.toBeNull();
      expect(result?.messageKey).toBe("insight.meal_correlation.food.warn");
      expect(result?.severityLevel).toBe("warn");
      const params = result?.messageParams as { foodName: string; delta: number };
      expect(params.foodName).toBe("Aloo paratha");
      expect(params.delta).toBe(40);
      const ev = result?.evidence as unknown as FoodResult;
      expect(ev.foodItemId).toBe("f1");
      expect(ev.readingType).toBe("post_meal");
      expect(result?.triggerReadings).toHaveLength(6);
    });

    it("picks the food with the largest upward delta across multiple foods", () => {
      const input = build([
        // Low baseline so all three foods sit clearly above it.
        ...rep(10, (i) => ({ day: (i % 7) + 1, hour: 21, value: 120, type: "post_meal" as const })),
        // f2 (mid, +16), inserted first → seeds worstFood.
        ...rep(5, (i) => ({
          day: i + 1,
          hour: 13,
          value: 170,
          type: "post_meal" as const,
          mealCategory: "normal" as const,
          foodItemId: "f2",
          foodName: "Idli",
        })),
        // f1 (high, +56) → overtakes f2 (delta > worst branch).
        ...rep(5, (i) => ({
          day: i + 1,
          hour: 9,
          value: 210,
          type: "post_meal" as const,
          mealCategory: "normal" as const,
          foodItemId: "f1",
          foodName: "Poori",
        })),
        // f3 (below baseline) → does not overtake (delta ≤ worst branch).
        ...rep(5, (i) => ({
          day: i + 1,
          hour: 16,
          value: 150,
          type: "post_meal" as const,
          mealCategory: "normal" as const,
          foodItemId: "f3",
          foodName: "Dosa",
        })),
      ]);
      const result = detectMealCategoryCorrelation(input);
      expect(result?.messageKey).toBe("insight.meal_correlation.food.critical");
      expect((result?.messageParams as { foodName: string }).foodName).toBe("Poori");
      expect((result?.evidence as unknown as FoodResult).foodItemId).toBe("f1");
    });

    it("falls back to the category pattern when the food link has no display name", () => {
      const input = build([
        // foodItemId present but foodName missing → not a usable food link.
        ...rep(6, (i) => ({
          day: i + 1,
          hour: 13,
          value: 220,
          type: "post_meal" as const,
          mealCategory: "heavy_fried" as const,
          foodItemId: "f1",
        })),
        ...rep(6, (i) => ({ day: i + 1, hour: 19, value: 140, type: "post_meal" as const })),
      ]);
      const result = detectMealCategoryCorrelation(input);
      expect(result?.messageKey).toBe("insight.meal_correlation.warn");
      expect((result?.messageParams as { mealCategory: string }).mealCategory).toBe("heavy_fried");
      expect(result?.messageParams).not.toHaveProperty("foodName");
    });

    it("falls back to category when fewer than minInstances of the food exist", () => {
      const input = build([
        // Only 4 linked instances of f1 — below the default 5.
        ...rep(4, (i) => ({
          day: i + 1,
          hour: 13,
          value: 230,
          type: "post_meal" as const,
          mealCategory: "normal" as const,
          foodItemId: "f1",
          foodName: "Poori",
        })),
        // 6 more "normal" meals with no food link → category bucket = 10.
        ...rep(6, (i) => ({
          day: i + 1,
          hour: 9,
          value: 230,
          type: "post_meal" as const,
          mealCategory: "normal" as const,
        })),
        ...rep(8, (i) => ({ day: (i % 7) + 1, hour: 21, value: 120, type: "post_meal" as const })),
      ]);
      const result = detectMealCategoryCorrelation(input);
      expect(result?.messageKey?.startsWith("insight.meal_correlation.")).toBe(true);
      expect(result?.messageKey).not.toContain(".food.");
      expect((result?.messageParams as { mealCategory: string }).mealCategory).toBe("normal");
    });

    it("falls back to category when the food delta is below the noise floor", () => {
      const input = build([
        // f1 barely above baseline (< INFO_DELTA) → food does not qualify.
        ...rep(5, (i) => ({
          day: i + 1,
          hour: 13,
          value: 158,
          type: "post_meal" as const,
          mealCategory: "heavy_fried" as const,
          foodItemId: "f1",
          foodName: "Idli",
        })),
        // Same heavy_fried category but no food link, well above baseline,
        // so the CATEGORY bucket clears the floor even though f1 doesn't.
        ...rep(5, (i) => ({
          day: i + 1,
          hour: 9,
          value: 220,
          type: "post_meal" as const,
          mealCategory: "heavy_fried" as const,
        })),
        ...rep(10, (i) => ({ day: (i % 7) + 1, hour: 21, value: 120, type: "post_meal" as const })),
      ]);
      const result = detectMealCategoryCorrelation(input);
      expect(result).not.toBeNull();
      expect(result?.messageKey).not.toContain(".food.");
      expect((result?.messageParams as { mealCategory: string }).mealCategory).toBe("heavy_fried");
    });
  });
});
