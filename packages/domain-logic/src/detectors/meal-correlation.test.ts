import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectMealCorrelation } from "./meal-correlation.js";
import type { MealEntry, TypedReading } from "./types.js";

const NOW = new Date("2026-05-13T20:00:00.000Z");
const dayMs = 86_400_000;
const hourMs = 60 * 60 * 1000;

const reading = (
  id: string,
  value: number,
  daysAgo: number,
  hoursOffset = 0,
): TypedReading => ({
  id,
  valueMgDl: value,
  readingType: "post_meal",
  measuredAt: new Date(
    NOW.getTime() - daysAgo * dayMs + hoursOffset * hourMs,
  ).toISOString(),
});

const meal = (
  id: string,
  category: MealEntry["mealCategory"],
  daysAgo: number,
  hoursOffset = -1,
): MealEntry => ({
  id,
  mealCategory: category,
  loggedAt: new Date(NOW.getTime() - daysAgo * dayMs + hoursOffset * hourMs).toISOString(),
});

describe("detectMealCorrelation — minimum-data gates", () => {
  it("returns null with no readings", () => {
    expect(
      detectMealCorrelation({ readings: [], meals: [], now: NOW }),
    ).toBeNull();
  });

  it("returns null when fewer than 5 post_meal readings exist", () => {
    const readings: TypedReading[] = [
      reading("a", 180, 0),
      reading("b", 170, 2),
      reading("c", 160, 4),
      reading("d", 175, 6),
    ];
    expect(
      detectMealCorrelation({ readings, meals: [], now: NOW }),
    ).toBeNull();
  });

  it("returns null when readings span < 3 days (packed into 24h)", () => {
    // 6 readings inside 24h → span guard kicks in.
    const readings: TypedReading[] = [
      reading("a", 0, 0),
      reading("b", 0, 0, -2),
      reading("c", 0, 0, -4),
      reading("d", 0, 0, -6),
      reading("e", 0, 0, -8),
      reading("f", 0, 0, -10),
    ].map((r, i) => ({ ...r, valueMgDl: 180 - i }));
    expect(
      detectMealCorrelation({ readings, meals: [], now: NOW }),
    ).toBeNull();
  });

  it("returns null when no category has 5+ attributed readings", () => {
    // 6 post_meal readings, but only 4 are inside a meal window.
    const readings: TypedReading[] = [
      reading("a", 180, 0),
      reading("b", 170, 2),
      reading("c", 160, 4),
      reading("d", 175, 6),
      reading("e", 178, 1),
      reading("f", 165, 5),
    ];
    const meals: MealEntry[] = [
      meal("m1", "heavy_fried", 0),
      meal("m2", "heavy_fried", 2),
      meal("m3", "heavy_fried", 4),
      meal("m4", "heavy_fried", 6),
      // Two readings with no meal in the prior 3h.
    ];
    expect(
      detectMealCorrelation({ readings, meals, now: NOW }),
    ).toBeNull();
  });
});

describe("detectMealCorrelation — happy path", () => {
  // For unambiguous attribution we put heavy_fried meals at hour offset
  // -8 (so the matching reading lands at -7h) and normal meals at -2h
  // (matching reading at -1h). Both within the 3-hour attribution
  // window AND well separated so no reading is closer to the wrong
  // meal.
  const pairsScenario = (hfValue: number, nValue: number) => {
    const readings: TypedReading[] = [];
    const meals: MealEntry[] = [];
    for (let d = 0; d < 5; d++) {
      meals.push(meal(`mh${d}`, "heavy_fried", d, -8));
      readings.push(reading(`hf${d}`, hfValue + d, d, -7));
      meals.push(meal(`mn${d}`, "normal", d, -2));
      readings.push(reading(`n${d}`, nValue + d, d, -1));
    }
    return { readings, meals };
  };

  it("flags heavy_fried when it averages well above the overall post_meal mean", () => {
    // heavy_fried ~220, normal ~150. Overall mean ≈ 185 → delta ≈ +35.
    const { readings, meals } = pairsScenario(220, 150);
    const result = detectMealCorrelation({ readings, meals, now: NOW });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("warn");
    expect(result!.messageParams.mealCategory).toBe("heavy_fried");
    expect(result!.evidence.categoryCount).toBe(5);
  });

  it("returns null when category mean is within 10 of overall (noise band)", () => {
    const { readings, meals } = pairsScenario(155, 150);
    expect(
      detectMealCorrelation({ readings, meals, now: NOW }),
    ).toBeNull();
  });

  it("escalates to critical when category mean exceeds overall by 50+", () => {
    // heavy_fried ~250, normal ~150 → overall ≈ 200 → delta ≈ +50.
    const { readings, meals } = pairsScenario(250, 150);
    const result = detectMealCorrelation({ readings, meals, now: NOW });
    expect(result).not.toBeNull();
    expect(result!.severityLevel).toBe("critical");
  });
});

describe("detectMealCorrelation — attribution window", () => {
  it("does NOT attribute a reading to a meal logged > 3h before it", () => {
    // Meal at -6h, reading at 0h → 6h gap > MEAL_WINDOW_HOURS.
    // Adding 5 such pairs across the week → no category clears the
    // min-5 threshold.
    const readings: TypedReading[] = [
      reading("a", 200, 0),
      reading("b", 200, 1),
      reading("c", 200, 2),
      reading("d", 200, 3),
      reading("e", 200, 4),
    ];
    const meals: MealEntry[] = [
      meal("m1", "heavy_fried", 0, -6),
      meal("m2", "heavy_fried", 1, -6),
      meal("m3", "heavy_fried", 2, -6),
      meal("m4", "heavy_fried", 3, -6),
      meal("m5", "heavy_fried", 4, -6),
    ];
    expect(
      detectMealCorrelation({ readings, meals, now: NOW }),
    ).toBeNull();
  });
});

describe("detectMealCorrelation — property invariants", () => {
  it("severityScore is always in [0, 100] when a result is returned", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 100, max: 300 }), {
          minLength: 10,
          maxLength: 30,
        }),
        (values) => {
          const readings: TypedReading[] = values.map((v, i) => reading(`r${i}`, v, i % 6));
          const meals: MealEntry[] = values.map((_, i) =>
            meal(`m${i}`, i % 2 === 0 ? "heavy_fried" : "normal", i % 6, -1),
          );
          const result = detectMealCorrelation({ readings, meals, now: NOW });
          if (result === null) return true;
          return result.severityScore >= 0 && result.severityScore <= 100;
        },
      ),
    );
  });
});
