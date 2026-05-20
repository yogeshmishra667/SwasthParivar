// Statistical helpers for the Phase 3 cross-condition detector
// (phase3.md B.1 #3). Welch's t-test plus the numerical machinery its
// p-value needs — the regularized incomplete beta function.
//
// Pure, IO-free, deterministic. Kept separate from `stats.ts` so this
// heavier numerical code carries its own coverage ratchet.
//
// References: the incomplete-beta continued fraction and the Lanczos
// log-gamma are the standard "Numerical Recipes" formulations.

import { mean } from "./stats.js";

/** Sample variance (Bessel-corrected, n-1 denominator). 0 for <2 values. */
export const variance = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) {
    const d = v - m;
    sumSq += d * d;
  }
  return sumSq / (values.length - 1);
};

// ── log-gamma (Lanczos approximation) ────────────────────────────────
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

const logGamma = (z: number): number => {
  if (z < 0.5) {
    // Reflection formula for the left half-plane.
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zz = z - 1;
  let x = LANCZOS_C[0];
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    x += (LANCZOS_C[i] ?? 0) / (zz + i);
  }
  const t = zz + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
};

// ── incomplete beta (Lentz continued fraction) ───────────────────────
const CF_MAX_ITER = 200;
const CF_EPS = 3e-12;
const CF_TINY = 1e-30;

const betaContinuedFraction = (x: number, a: number, b: number): number => {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < CF_TINY) d = CF_TINY;
  d = 1 / d;
  let result = d;

  for (let m = 1; m <= CF_MAX_ITER; m += 1) {
    const m2 = 2 * m;
    // Even step.
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < CF_TINY) d = CF_TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < CF_TINY) c = CF_TINY;
    d = 1 / d;
    result *= d * c;
    // Odd step.
    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < CF_TINY) d = CF_TINY;
    c = 1 + numerator / c;
    if (Math.abs(c) < CF_TINY) c = CF_TINY;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < CF_EPS) break;
  }
  return result;
};

/**
 * Regularized incomplete beta function I_x(a, b) ∈ [0, 1].
 * Exported for testing; detectors use `welchTTest`.
 */
export const incompleteBeta = (x: number, a: number, b: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  // Pick the faster-converging tail.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
};

/** Two-tailed p-value of a Student's t statistic with `df` degrees of freedom. */
export const studentTTwoTailedP = (t: number, df: number): number => {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
};

export interface WelchTTestResult {
  /** t statistic (sign follows meanA - meanB). */
  t: number;
  /** Welch–Satterthwaite degrees of freedom. */
  df: number;
  /** Two-tailed p-value ∈ [0, 1]. */
  pValue: number;
}

/**
 * Welch's two-sample t-test (does NOT assume equal variances). Returns
 * `null` when either sample has fewer than 2 values — a t-test is
 * undefined there. When both samples are constant the result is exact:
 * equal means → p = 1, unequal means → p = 0.
 */
export const welchTTest = (
  sampleA: readonly number[],
  sampleB: readonly number[],
): WelchTTestResult | null => {
  const nA = sampleA.length;
  const nB = sampleB.length;
  if (nA < 2 || nB < 2) return null;

  const meanA = mean(sampleA);
  const meanB = mean(sampleB);
  const seA = variance(sampleA) / nA;
  const seB = variance(sampleB) / nB;
  const seSum = seA + seB;

  if (seSum === 0) {
    // Both samples have zero variance — a degenerate but valid case.
    return { t: 0, df: nA + nB - 2, pValue: meanA === meanB ? 1 : 0 };
  }

  const t = (meanA - meanB) / Math.sqrt(seSum);
  const df = (seSum * seSum) / ((seA * seA) / (nA - 1) + (seB * seB) / (nB - 1));
  return { t, df, pValue: studentTTwoTailedP(t, df) };
};
