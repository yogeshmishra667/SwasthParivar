// Phase 2 — `computeHealthScore`. Pure function that blends 5 signals
// into a single 0-100 number. Source weights (CLAUDE.md):
//
//   logging   20%   — does the patient track frequently enough?
//   stability 25%   — how variable is their fasting glucose?
//   trend     25%   — is fasting glucose drifting up or staying flat?
//   med       20%   — are they taking medications when scheduled?
//   streak    10%   — gamification weight; never the dominant signal
//
// Each component is mapped to 0-100 by a linear ramp between an
// "excellent" point and a "concerning" point. Outputs are deterministic
// for a given input — there is no `Date.now()`, no randomness.

import { linearRegression, stdDev } from "../detectors/stats.js";
import {
  HEALTH_SCORE_WEIGHTS,
  type HealthScore,
  type HealthScoreComponents,
  type HealthScoreInput,
  type HealthScoreReading,
} from "./types.js";

// Re-export so consumers can pull `computeHealthScore` and
// `HEALTH_SCORE_WEIGHTS` from the same module file.
export { HEALTH_SCORE_WEIGHTS };

const dayMs = 86_400_000;

// --- Component scorers --------------------------------------------------

// Logging: target 2 logs/day in last 14 days = 28 logs → 100.
// 0 logs → 0. Linear ramp.
const LOGGING_TARGET_PER_DAY = 2;
const LOGGING_WINDOW_DAYS = 14;
const LOGGING_TARGET = LOGGING_TARGET_PER_DAY * LOGGING_WINDOW_DAYS;

const scoreLogging = (readings: readonly HealthScoreReading[]): number => {
  if (readings.length === 0) return 0;
  return Math.min(100, (readings.length / LOGGING_TARGET) * 100);
};

// Stability: fasting σ ≤ 15 mg/dL = 100. σ ≥ 50 = 0. Linear.
// Below 3 readings we can't compute meaningful σ — give partial credit
// (50) so a new user isn't punished.
const STABILITY_SIGMA_EXCELLENT = 15;
const STABILITY_SIGMA_CONCERNING = 50;
const STABILITY_INSUFFICIENT_DATA = 50;

const scoreStability = (readings: readonly HealthScoreReading[]): number => {
  if (readings.length < 3) return STABILITY_INSUFFICIENT_DATA;
  const sigma = stdDev(readings.map((r) => r.valueMgDl));
  if (sigma <= STABILITY_SIGMA_EXCELLENT) return 100;
  if (sigma >= STABILITY_SIGMA_CONCERNING) return 0;
  const range = STABILITY_SIGMA_CONCERNING - STABILITY_SIGMA_EXCELLENT;
  return Math.round(((STABILITY_SIGMA_CONCERNING - sigma) / range) * 100);
};

// Trend: linear regression slope on fasting glucose. Flat or improving
// (≤ 0 mg/dL/day) → 100. Rapidly worsening (≥ 5 mg/dL/day) → 0.
// Min 5 readings to fit a line; below that → 50 (insufficient data).
const TREND_SLOPE_EXCELLENT = 0;
const TREND_SLOPE_CONCERNING = 5;
const TREND_MIN_POINTS = 5;
const TREND_INSUFFICIENT_DATA = 50;

const scoreTrend = (readings: readonly HealthScoreReading[], nowMs: number): number => {
  if (readings.length < TREND_MIN_POINTS) return TREND_INSUFFICIENT_DATA;

  const oldestMs = Math.min(...readings.map((r) => new Date(r.measuredAt).getTime()));
  // Normalise x to days-since-oldest so slope reads as mg/dL/day.
  const points = readings.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - oldestMs) / dayMs,
    y: r.valueMgDl,
  }));
  // Guard: if all x identical (all readings at one timestamp), fit
  // returns null — give partial credit, not zero.
  const fit = linearRegression(points);
  if (fit === null) return TREND_INSUFFICIENT_DATA;
  // Low R² means scatter, not a clear trend — don't punish.
  if (fit.rSquared < 0.3) return Math.max(50, 100 - Math.abs(fit.slope) * 5);

  const slope = fit.slope;
  if (slope <= TREND_SLOPE_EXCELLENT) return 100;
  if (slope >= TREND_SLOPE_CONCERNING) return 0;
  const range = TREND_SLOPE_CONCERNING - TREND_SLOPE_EXCELLENT;
  // Voiding nowMs: keep param for future extensions (e.g. weighting by
  // recency); silently use today so the caller's contract stays stable.
  void nowMs;
  return Math.round(((TREND_SLOPE_CONCERNING - slope) / range) * 100);
};

// Medication: take ratio over scheduled doses in the 14-day window.
// "delayed" counts as taken (the patient eventually took it).
// "missed_no_response" + "skipped" count as missed.
const scoreMedication = (logs: readonly { status: string }[]): number => {
  if (logs.length === 0) return 50; // no schedule yet → neutral
  let taken = 0;
  let missed = 0;
  for (const l of logs) {
    if (l.status === "taken" || l.status === "delayed") taken += 1;
    else if (l.status === "missed_no_response" || l.status === "skipped") missed += 1;
  }
  const total = taken + missed;
  if (total === 0) return 50;
  return Math.round((taken / total) * 100);
};

// Streak: 14+ days → 100. Linear ramp from 0.
const STREAK_TARGET_DAYS = 14;

const scoreStreak = (days: number): number => {
  if (days <= 0) return 0;
  return Math.min(100, Math.round((days / STREAK_TARGET_DAYS) * 100));
};

// --- Public entry point -------------------------------------------------

const formatDateUtc = (d: Date): string => d.toISOString().slice(0, 10);

export const computeHealthScore = (input: HealthScoreInput): HealthScore => {
  const components: HealthScoreComponents = {
    logging: Math.round(scoreLogging(input.allReadingsLast14d)),
    stability: scoreStability(input.fastingReadingsLast14d),
    trend: scoreTrend(input.fastingReadingsLast30d, input.now.getTime()),
    medication: scoreMedication(input.medicationLogsLast14d),
    streak: scoreStreak(input.currentStreakDays),
  };

  // Weighted total. Weights sum to 100, so the division simplifies to
  // (sum / 100). Round to nearest int for the storable score.
  const weighted =
    components.logging * HEALTH_SCORE_WEIGHTS.logging +
    components.stability * HEALTH_SCORE_WEIGHTS.stability +
    components.trend * HEALTH_SCORE_WEIGHTS.trend +
    components.medication * HEALTH_SCORE_WEIGHTS.medication +
    components.streak * HEALTH_SCORE_WEIGHTS.streak;
  const score = Math.round(weighted / 100);

  return {
    score,
    components,
    weights: HEALTH_SCORE_WEIGHTS,
    computedForDate: formatDateUtc(input.now),
    computedAtIso: input.now.toISOString(),
  };
};
