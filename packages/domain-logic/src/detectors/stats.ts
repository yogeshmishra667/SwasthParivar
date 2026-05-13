// Pure statistics helpers used by every detector. Kept in one file so
// the math (and its test surface) lives in one place.
//
// Invariants enforced across all helpers:
//   • Empty input → return null/0 (never NaN, never throw).
//   • Constant input (IQR=0 / stdDev=0) is a valid result, not an error.
//   • No side effects, no `Date.now()`, no `Math.random()`.

/** Arithmetic mean of a non-empty sample, or 0 for empty. */
export const mean = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
};

/**
 * Sample median (P50). Returns 0 for an empty input.
 * Uses the standard average-of-middle-two for even counts so the result
 * is stable across re-orderings.
 */
export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
};

/**
 * Population standard deviation. Used by the spike detector to express
 * "how far is this value from the rolling median, in σ units".
 * Returns 0 for empty or constant input.
 */
export const stdDev = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) {
    const d = v - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
};

/**
 * Interquartile range (Q3 - Q1). CLAUDE.md explicitly mandates IQR over
 * mean+σ for the anomaly detector — IQR is robust to the very outliers
 * we're trying to flag.
 *
 * Uses the "Tukey hinges" definition: P25 and P75 via linear
 * interpolation on the sorted sample. Returns 0 for empty or constant
 * input.
 */
export interface IqrResult {
  q1: number;
  q3: number;
  iqr: number;
}

export const iqr = (values: readonly number[]): IqrResult => {
  if (values.length === 0) return { q1: 0, q3: 0, iqr: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return { q1, q3, iqr: q3 - q1 };
};

/**
 * Linear-interpolated percentile on a pre-sorted array. Internal — most
 * callers want `median` or `iqr`.
 */
const percentile = (sortedAsc: readonly number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0] ?? 0;
  const rank = p * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo] ?? 0;
  const weight = rank - lo;
  return (sortedAsc[lo] ?? 0) * (1 - weight) + (sortedAsc[hi] ?? 0) * weight;
};

/**
 * Ordinary least-squares regression on a series of (x, y) pairs.
 * Returns slope, intercept, and R² (coefficient of determination).
 *
 * Used by the trend detector with x = days-since-first-point, y =
 * reading value. The R² threshold (> 0.5 per CLAUDE.md) gates whether
 * a trend is reportable at all — low R² = scatter, not a trend.
 *
 * Edge cases:
 *   • < 2 points → null (can't fit a line)
 *   • Constant x (all same timestamp) → null (slope undefined)
 *   • Constant y → slope 0, intercept y[0], R² 0 (no trend, but valid)
 */
export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

export const linearRegression = (
  points: readonly { x: number; y: number }[],
): RegressionResult | null => {
  if (points.length < 2) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denomSlope = n * sumX2 - sumX * sumX;
  if (denomSlope === 0) return null; // all x identical

  const slope = (n * sumXY - sumX * sumY) / denomSlope;
  const intercept = (sumY - slope * sumX) / n;

  // R² = 1 - SSres / SStot. SStot = 0 (constant y) → R² = 0 by
  // convention (a flat line through a flat dataset has no explanatory
  // power, but it's not a fit error).
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of points) {
    const yHat = slope * x + intercept;
    ssRes += (y - yHat) * (y - yHat);
    ssTot += (y - meanY) * (y - meanY);
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
};

/**
 * Rolling-window helper: returns the median of values whose timestamps
 * fall in the closed interval [now - windowMs, now]. Caller supplies
 * `nowMs` to keep the helper pure.
 */
export const rollingMedian = (
  values: readonly { measuredAtMs: number; value: number }[],
  nowMs: number,
  windowMs: number,
): number => {
  const cutoff = nowMs - windowMs;
  const inWindow: number[] = [];
  for (const v of values) {
    if (v.measuredAtMs >= cutoff && v.measuredAtMs <= nowMs) {
      inWindow.push(v.value);
    }
  }
  return median(inWindow);
};

/**
 * Inclusive day count between two ISO-ish timestamps in ms. Days are
 * computed in UTC to keep the helper deterministic; detectors that need
 * IST-specific boundaries should convert before calling.
 */
export const daysBetween = (earlierMs: number, laterMs: number): number => {
  if (laterMs < earlierMs) return 0;
  return Math.floor((laterMs - earlierMs) / 86_400_000);
};
