// Shared types for all Phase 2 detectors. Pattern strings + severity
// levels are re-exported from @swasth/shared-types so client + server +
// domain-logic all agree on the contract.

import type { InsightPatternType, InsightSeverityLevel } from "@swasth/shared-types";

/**
 * The minimum reading shape detectors need. Mirrors GlucoseReading /
 * BPReading minus DB-internal fields. Detectors stay pure; the caller
 * (a server service or worker) is responsible for converting Prisma
 * rows into this shape.
 */
export interface TypedReading {
  id: string;
  valueMgDl: number;
  readingType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
  measuredAt: string;
  /**
   * Optional reading context. `festive` readings are excluded by the
   * meal-category correlation detector (a Diwali sweet is not a
   * dietary pattern). Absent → treated as `normal`.
   */
  context?: "normal" | "festive";
}

/**
 * Minimum BP-reading shape the cross-condition detector needs. Mirrors
 * the server `BPReading` Prisma model minus DB-internal fields. The
 * caller maps Prisma rows to this shape at the service boundary so the
 * detector stays pure.
 */
export interface TypedBPReading {
  id: string;
  systolic: number;
  diastolic: number;
  measuredAt: string;
}

/**
 * Meal log shape the meal-correlation detector consumes. Mirrors the
 * server `MealLog` Prisma model minus DB-internal fields. Kept here so
 * the detector stays pure — caller maps Prisma rows to this shape at
 * the service boundary.
 */
export interface MealEntry {
  id: string;
  mealCategory: "light" | "normal" | "heavy_fried";
  loggedAt: string;
  /**
   * Phase 4 §H — optional link to a canonical IndianFoodItem and its
   * display name. When present and the same food recurs ≥ minInstances
   * times, the meal-correlation detector surfaces a food-specific
   * pattern ("Aloo paratha ke baad sugar 40 zyada") instead of the
   * coarser category pattern. BOTH are required to take the food path:
   * the id groups readings, the name renders the message. Absent →
   * detector falls back to category grouping (existing behaviour).
   */
  foodItemId?: string;
  foodName?: string;
}

/**
 * Cardiac-reading shape for the cardiac-trend detector (Phase 4
 * Feature E). Heart-rate-only by design — CLAUDE.md "Phase 4
 * Invariants — never-mix-conditions": cardiac trend never reads
 * BP/glucose/respiratory data. Caller maps `CardiacLog` Prisma rows
 * to this shape at the service boundary.
 */
export interface TypedCardiacReading {
  id: string;
  heartRateBpm: number;
  measuredAt: string;
}

/**
 * Respiratory-reading shape for the respiratory-trend detector
 * (Phase 4 Feature E). Peak-flow only — caller filters out rows
 * with `peakFlow === null` before passing the array in, so the
 * detector never has to handle a missing value. Inhaler-use and
 * symptom severity are bypass-band signals, not trend signals,
 * and stay out of this shape.
 */
export interface TypedRespiratoryReading {
  id: string;
  peakFlow: number;
  measuredAt: string;
}

/**
 * Uniform output shape for every detector. Returning `null` is how a
 * detector says "not enough data" or "below confidence floor" — it is
 * NOT an error and the caller never logs it. Persisting null-results
 * would just clutter the feed without giving the patient any signal.
 */
export interface DetectorResult {
  patternType: InsightPatternType;
  conditionsInvolved: readonly string[];
  severityScore: number; // 0-100
  severityLevel: InsightSeverityLevel;
  messageKey: string;
  messageParams: Record<string, unknown>;
  triggerReadings: readonly string[]; // reading ids
  evidence: Record<string, unknown>;
  confidence: number; // 0-1
}

/**
 * Detector contract: pure function from (readings + now) to (result | null).
 * Time is always a parameter — never call `new Date()` inside a detector.
 */
export type Detector<TInput> = (input: TInput) => DetectorResult | null;
