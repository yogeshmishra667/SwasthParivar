// Cardiac-trend detector — fits a line through the last N heart-rate
// readings in the requested window and surfaces only when the fit is
// meaningful (R² > 0.5) AND the slope is non-trivial.
//
// Spec (CLAUDE.md "Insight Engine" + phase4.md §E.2):
//   • Linear regression on 5 / 14 / 30 day windows
//   • R² > 0.5 gate — scatter is not a trend
//   • Min 5 points (parity with `detectors/trend.ts`)
//   • Cardiac data ONLY — never reads BP / glucose / respiratory
//     (the never-mix-conditions invariant; phase4.md §E.2 #5)
//   • Slope is bpm/day — x normalised to days-since-oldest so the
//     human-readable thresholds make sense
//
// Why a separate file rather than parameterising `detectors/trend.ts`:
// the value column, the conditions tag, and the human thresholds all
// differ across categories. A shared base would force every category
// to share thresholds, which would silently weaken cardiac (where 2
// bpm/day is "notable", not 2 mg/dL/day).

import { daysBetween, linearRegression } from "./stats.js";
import type { DetectorResult, TypedCardiacReading } from "./types.js";

export interface CardiacTrendDetectorInput {
  readings: readonly TypedCardiacReading[];
  windowDays: 5 | 14 | 30;
  now: Date;
}

// Slope thresholds in bpm/day. Calibrated proportionally to the
// glucose detector's TREND_NOTABLE_SLOPE=2 mg/dL/day against a
// typical 100-180 mg/dL range: HR has a tighter typical range
// (60-100), so a smaller absolute drift is already clinically
// notable.
const TREND_NULL_SLOPE_BPM_PER_DAY = 0.5;
const TREND_NOTABLE_SLOPE_BPM_PER_DAY = 1.0;
const TREND_RAPID_SLOPE_BPM_PER_DAY = 2.5;
const TREND_MIN_POINTS = 5;
const TREND_R_SQUARED_GATE = 0.5;

const dayMs = 86_400_000;

export const detectCardiacTrend = (input: CardiacTrendDetectorInput): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - input.windowDays * dayMs;

  const inWindow = input.readings.filter((r) => {
    const t = new Date(r.measuredAt).getTime();
    return t >= windowStartMs && t <= nowMs;
  });

  if (inWindow.length < TREND_MIN_POINTS) return null;

  // Span check — 5 readings packed into one hour pass the min-points
  // gate but are not a trend. Require the points to spread across at
  // least a third of the window (min 2 days). Mirrors glucose trend.
  const oldestMs = Math.min(...inWindow.map((r) => new Date(r.measuredAt).getTime()));
  const span = daysBetween(oldestMs, nowMs);
  if (span < Math.max(2, Math.floor(input.windowDays / 3))) return null;

  const points = inWindow.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - oldestMs) / dayMs,
    y: r.heartRateBpm,
  }));

  const fit = linearRegression(points);
  if (fit === null) return null; // all timestamps identical → undefined slope
  if (fit.rSquared < TREND_R_SQUARED_GATE) return null;

  const absSlope = Math.abs(fit.slope);
  if (absSlope < TREND_NULL_SLOPE_BPM_PER_DAY) return null;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (absSlope >= TREND_RAPID_SLOPE_BPM_PER_DAY) {
    severityLevel = "critical";
    severityScore = 85;
    messageKey = "insight.cardiac.trend.rapid";
  } else if (absSlope >= TREND_NOTABLE_SLOPE_BPM_PER_DAY) {
    severityLevel = "warn";
    severityScore = 65;
    messageKey = "insight.cardiac.trend.notable";
  } else {
    severityLevel = "info";
    severityScore = 45;
    messageKey = "insight.cardiac.trend.slow";
  }

  // Confidence anchored on R². Depth boost slightly favours 30-point
  // fits over 5-point fits without letting a 0.6 R² 30-point trend
  // outrank a 0.9 R² 7-point trend.
  const depthBoost = Math.min(1, inWindow.length / 14);
  const confidence = Math.min(1, fit.rSquared * (0.8 + 0.2 * depthBoost));

  return {
    patternType: "trend",
    // Never-mix-conditions: this detector only ever tags `cardiac`.
    // Cross-condition correlation (BP-cardiac, glucose-cardiac) lives
    // in a separate detector — never this one.
    conditionsInvolved: ["cardiac"],
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
