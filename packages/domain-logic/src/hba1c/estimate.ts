// Phase 2 — HbA1c estimator. Pure function over a 90-day glucose
// history. Per CLAUDE.md:
//
//   HbA1c% ≈ (avg_glucose_90d_weighted + 46.7) / 28.7
//
// Weights (recency-biased):
//   recent 30d (0-30 days ago)  × 1.5
//   middle 30d (30-60 days ago) × 1.0
//   oldest 30d (60-90 days ago) × 0.5
//
// Why recency-biased: HbA1c reflects 8-12 weeks of glycaemia in real
// life, but the lab number is weighted toward the more-recent half of
// that window (red-cell turnover). The patient sees a number that
// moves when their habits change, not one that lags by 3 months.
//
// Minimum data:
//   • ≥ 30 readings overall (PROGRESS.md step 4)
//   • At least the recent (0-30d) window must be non-empty — without
//     fresh data the recency-weighted average is meaningless.
//
// All outputs labelled "ESTIMATE" and the caller surfaces a "confirm
// with a lab" prompt — this is never a diagnostic number.

import type { HbA1cEstimate, HbA1cReadingInput, HbA1cWindowStats } from "./types.js";

const RECENT_WEIGHT = 1.5;
const MIDDLE_WEIGHT = 1.0;
const OLDEST_WEIGHT = 0.5;
const MIN_TOTAL_READINGS = 30;
const dayMs = 86_400_000;

// Linear regression of HbA1c vs mean glucose, from the ADAG/A1c-derived
// average glucose curve. Source: Nathan et al. 2008
//   HbA1c% ≈ (mean_mg_dl + 46.7) / 28.7
const HBA1C_INTERCEPT = 46.7;
const HBA1C_SLOPE = 28.7;

export interface EstimateHbA1cInput {
  readings: readonly HbA1cReadingInput[];
  now: Date;
}

const meanMgDl = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
};

export const estimateHbA1c = (input: EstimateHbA1cInput): HbA1cEstimate | null => {
  const nowMs = input.now.getTime();
  const recentStart = nowMs - 30 * dayMs;
  const middleStart = nowMs - 60 * dayMs;
  const oldestStart = nowMs - 90 * dayMs;

  // Window-partition the input. Anything older than 90 days is silently
  // dropped — HbA1c reflects ≤ 90 days.
  const recent: number[] = [];
  const middle: number[] = [];
  const oldest: number[] = [];
  for (const r of input.readings) {
    const t = new Date(r.measuredAt).getTime();
    if (Number.isNaN(t)) continue;
    if (t > nowMs) continue; // future-dated readings — silently skip
    if (t >= recentStart) {
      recent.push(r.valueMgDl);
    } else if (t >= middleStart) {
      middle.push(r.valueMgDl);
    } else if (t >= oldestStart) {
      oldest.push(r.valueMgDl);
    }
  }

  const totalReadings = recent.length + middle.length + oldest.length;
  if (totalReadings < MIN_TOTAL_READINGS) return null;

  // The recency-bias only works if we have a recent window. A patient
  // with 30 readings in the 60-90 day bucket and nothing fresher
  // shouldn't get an estimate — the number would mislead.
  if (recent.length === 0) return null;

  // Weighted mean: the per-window weight applies once, then the means
  // are blended in proportion to (weight × readingCount). Skipping a
  // window cleanly drops out — the formula degenerates to the
  // remaining windows' weighted mean.
  const windows: HbA1cWindowStats[] = [
    { meanMgDl: meanMgDl(recent), readingCount: recent.length, weight: RECENT_WEIGHT },
    { meanMgDl: meanMgDl(middle), readingCount: middle.length, weight: MIDDLE_WEIGHT },
    { meanMgDl: meanMgDl(oldest), readingCount: oldest.length, weight: OLDEST_WEIGHT },
  ];

  let weightedSum = 0;
  let weightTotal = 0;
  for (const w of windows) {
    if (w.readingCount === 0) continue;
    const effectiveWeight = w.weight * w.readingCount;
    weightedSum += w.meanMgDl * effectiveWeight;
    weightTotal += effectiveWeight;
  }
  // weightTotal cannot be zero here — totalReadings ≥ 30 guarantees at
  // least one window has readingCount > 0, and recent.length > 0
  // strengthens that further.
  const weightedAverageMgDl = weightedSum / weightTotal;

  const hba1cPercent = (weightedAverageMgDl + HBA1C_INTERCEPT) / HBA1C_SLOPE;

  return {
    hba1cPercent: Math.round(hba1cPercent * 10) / 10,
    weightedAverageMgDl: Math.round(weightedAverageMgDl * 10) / 10,
    totalReadings,
    windows: {
      recent: windows[0]!,
      middle: windows[1]!,
      oldest: windows[2]!,
    },
    label: "ESTIMATE",
    computedAtIso: input.now.toISOString(),
  };
};
