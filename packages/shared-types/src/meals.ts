// Meal logs (Phase 2) — context for post-meal glucose readings. Used by
// the meal-correlation detector to group readings by meal category and
// surface "heavy_fried meals correlate with post-meal spikes" insights.

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// Patient-facing category — three buckets capture enough glycemic-load
// signal for correlation without asking elderly users to estimate
// carbs / GI. Hindi labels in the mobile UI: halka / normal / bhaari.
export type MealCategory = "light" | "normal" | "heavy_fried";

export interface MealLog {
  id: string;
  clientUuid: string;
  userId: string;
  mealType: MealType;
  mealCategory: MealCategory;
  foodDescription?: string;
  loggedAt: string;
  version: number;
  syncedAt?: string;
}

export interface CreateMealLogInput {
  clientUuid: string;
  mealType: MealType;
  mealCategory: MealCategory;
  foodDescription?: string;
  loggedAt: string;
  version?: number;
}

export const MEAL_TYPES: readonly MealType[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
] as const;

export const MEAL_CATEGORIES: readonly MealCategory[] = [
  "light",
  "normal",
  "heavy_fried",
] as const;
