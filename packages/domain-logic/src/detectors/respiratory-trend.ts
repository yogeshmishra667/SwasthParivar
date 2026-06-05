// Respiratory-trend detector — fits a line through the last N peak-flow
// readings in the requested window and surfaces only when the fit is
// meaningful (R² > 0.5) AND the slope is non-trivial.
//
// Spec (CLAUDE.md "Insight Engine" + phase4.md §E.2):
//   • Linear regression on 5 / 14 / 30 day windows
//   • R² > 0.5 gate — scatter is not a trend
//   • Min 5 points (parity with `detectors/trend.ts`)
//   • Respiratory data ONLY — never reads cardiac/BP/glucose
//     (the never-mix-conditions invariant; phase4.md §E.2 #5)
//   • Slope is L/min/day — x normalised to days-since-oldest
//
// Why peak-flow only: inhaler-use and symptom severity are categorical
// red-zone signals already handled by the bypass classifier
// (`respiratory-thresholds/classifier.ts`). A trend in them is not the
// same as a trend in peak flow; folding them in would silently
// re-weight the regression.
//
// The caller is responsible for filtering out rows where
// `peakFlow === null` BEFORE passing them in (the input type makes
// `peakFlow` non-nullable). This keeps the detector pure of null
// handling and the contract obvious.

import { daysBetween, linearRegression } from "./stats.js";
import type { DetectorResult, TypedRespiratoryReading } from "./types.js";

export interface RespiratoryTrendDetectorInput {
  readings: readonly TypedRespiratoryReading[];
  windowDays: 5 | 14 | 30;
  now: Date;
}

// Slope thresholds in L/min/day. Calibrated against a typical
// peak-flow range of 300-600 L/min: a 10 L/min/day drift over a week
// (70 L/min) is roughly a 15% baseline shift — clinically notable.
// 5 L/min/day is below noise floor for most peak-flow meters.
const TREND_NULL_SLOPE_LMIN_PER_DAY = 5;
const TREND_NOTABLE_SLOPE_LMIN_PER_DAY = 10;
const TREND_RAPID_SLOPE_LMIN_PER_DAY = 25;
const TREND_MIN_POINTS = 5;
const TREND_R_SQUARED_GATE = 0.5;

const dayMs = 86_400_000;

export const detectRespiratoryTrend = (
  input: RespiratoryTrendDetectorInput,
): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - input.windowDays * dayMs;

  const inWindow = input.readings.filter((r) => {
    const t = new Date(r.measuredAt).getTime();
    return t >= windowStartMs && t <= nowMs;
  });

  if (inWindow.length < TREND_MIN_POINTS) return null;

  const oldestMs = Math.min(...inWindow.map((r) => new Date(r.measuredAt).getTime()));
  const span = daysBetween(oldestMs, nowMs);
  if (span < Math.max(2, Math.floor(input.windowDays / 3))) return null;

  const points = inWindow.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - oldestMs) / dayMs,
    y: r.peakFlow,
  }));

  const fit = linearRegression(points);
  if (fit === null) return null;
  if (fit.rSquared < TREND_R_SQUARED_GATE) return null;

  const absSlope = Math.abs(fit.slope);
  if (absSlope < TREND_NULL_SLOPE_LMIN_PER_DAY) return null;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (absSlope >= TREND_RAPID_SLOPE_LMIN_PER_DAY) {
    severityLevel = "critical";
    severityScore = 85;
    messageKey = "insight.respiratory.trend.rapid";
  } else if (absSlope >= TREND_NOTABLE_SLOPE_LMIN_PER_DAY) {
    severityLevel = "warn";
    severityScore = 65;
    messageKey = "insight.respiratory.trend.notable";
  } else {
    severityLevel = "info";
    severityScore = 45;
    messageKey = "insight.respiratory.trend.slow";
  }

  const depthBoost = Math.min(1, inWindow.length / 14);
  const confidence = Math.min(1, fit.rSquared * (0.8 + 0.2 * depthBoost));

  return {
    patternType: "trend",
    // Never-mix-conditions: respiratory trend NEVER tags cardiac/BP/
    // glucose. Cross-condition correlations live in a separate
    // detector (cross-condition.ts).
    conditionsInvolved: ["respiratory"],
    severityScore,
    severityLevel,
    messageKey,
    messageParams: {
      direction: fit.slope > 0 ? "increasing" : "decreasing",
      slopePerDay: Math.round(fit.slope * 10) / 10,
      windowDays: input.windowDays,
    },
    triggerReadings: inWindow.map((r) => r.id),
    evidence: {
      slope: Math.round(fit.slope * 1000) / 1000,
      intercept: Math.round(fit.intercept * 100) / 100,
      rSquared: Math.round(fit.rSquared * 1000) / 1000,
      sampleSize: inWindow.length,
      windowDays: input.windowDays,
      spanDays: span,
    },
    confidence,
  };
};
