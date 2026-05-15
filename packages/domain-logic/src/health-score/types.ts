// Phase 2 — HealthScore input/output shapes. Pure data; the caller
// (DAILY_HEALTH_SCORE worker) reads Prisma rows and converts them to
// these shapes at the service boundary so the math stays pure.

/** Glucose reading reduced to fields the score uses. */
export interface HealthScoreReading {
  valueMgDl: number;
  measuredAt: string; // ISO 8601
}

/** Medication log status — mirrors `MedicationLogStatus` from shared-types
 * but kept local so domain-logic stays free of Prisma enums. */
export type HealthScoreMedStatus = "taken" | "skipped" | "missed_no_response" | "delayed";

export interface HealthScoreMedLog {
  status: HealthScoreMedStatus;
}

/**
 * Inputs to the daily score. All time windows are caller-curated; the
 * function never calls `Date.now()` itself. `now` is the date the score
 * is computed *for* (used to emit `computedForDate`).
 */
export interface HealthScoreInput {
  // Logging frequency — every reading in the last 14 days, any type.
  allReadingsLast14d: readonly HealthScoreReading[];
  // Stability — fasting readings only (most-comparable type).
  fastingReadingsLast14d: readonly HealthScoreReading[];
  // Trend — fasting readings across 30 days so slope has signal.
  fastingReadingsLast30d: readonly HealthScoreReading[];
  // Medication adherence — every MedicationLog in the last 14 days.
  medicationLogsLast14d: readonly HealthScoreMedLog[];
  currentStreakDays: number;
  now: Date;
}

/**
 * Per-component score (0-100). Weighted into the final score using the
 * fixed weights below.
 */
export interface HealthScoreComponents {
  logging: number;
  stability: number;
  trend: number;
  medication: number;
  streak: number;
}

/** Component weights — sum to 100, hard-coded per CLAUDE.md. */
export const HEALTH_SCORE_WEIGHTS = {
  logging: 20,
  stability: 25,
  trend: 25,
  medication: 20,
  streak: 10,
} as const;

export interface HealthScore {
  /** 0-100, rounded to nearest integer. */
  score: number;
  components: HealthScoreComponents;
  weights: typeof HEALTH_SCORE_WEIGHTS;
  /** YYYY-MM-DD in UTC. Caller can interpret as user's local date. */
  computedForDate: string;
  computedAtIso: string;
}
