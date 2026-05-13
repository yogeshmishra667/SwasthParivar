// Trend detector — fits a line through the last N same-type readings
// and surfaces only when the fit is meaningful (R² > 0.5) AND the
// slope is non-trivial. Glucose only this phase.
//
// Spec (CLAUDE.md Insight Engine):
//   • Linear regression on 5 / 14 / 30 day windows
//   • R² > 0.5 gate — scatter is not a trend
//   • Min 5 points (CLAUDE.md "Minimum Data")
//   • Same reading_type only
//   • Slope is mg/dL per day (we normalise x to days-since-first-point)
//
// Why three windows: a 5-day window catches a fast-developing trend
// before it's a spike (e.g. medication changeover). 14-day captures
// the patient's "current state". 30-day surfaces slow drift the
// patient can't feel. The caller picks the window; each lands as its
// own InsightEvent so the UI can group "short-term vs long-term".

import { linearRegression, daysBetween } from "./stats.js";
import type { DetectorResult, TypedReading } from "./types.js";

export interface TrendDetectorInput {
  readings: readonly TypedReading[];
  windowDays: 5 | 14 | 30;
  targetReadingType: TypedReading["readingType"];
  now: Date;
}

// Slope thresholds in mg/dL per day. Below 1 means roughly flat over a
// week (< 7 mg/dL drift) — not actionable.
const TREND_NULL_SLOPE = 1;
const TREND_NOTABLE_SLOPE = 2;
const TREND_RAPID_SLOPE = 5;
const TREND_MIN_POINTS = 5;
const TREND_R_SQUARED_GATE = 0.5;

const dayMs = 86_400_000;

export const detectTrend = (input: TrendDetectorInput): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - input.windowDays * dayMs;

  const sameType = input.readings.filter(
    (r) => r.readingType === input.targetReadingType,
  );

  const inWindow = sameType.filter((r) => {
    const t = new Date(r.measuredAt).getTime();
    return t >= windowStartMs && t <= nowMs;
  });

  if (inWindow.length < TREND_MIN_POINTS) return null;

  // Span check — without it, 5 readings packed into a single hour would
  // pass the min-points gate. CLAUDE.md "min 5 points + R² > 0.5"
  // assumes those points are spread across the window.
  const oldestMs = Math.min(
    ...inWindow.map((r) => new Date(r.measuredAt).getTime()),
  );
  const span = daysBetween(oldestMs, nowMs);
  if (span < Math.max(2, Math.floor(input.windowDays / 3))) return null;

  // Normalise x to days-since-oldest so slope reads as mg/dL/day. Using
  // raw ms would give a tiny slope and the human-readable thresholds
  // wouldn't make sense.
  const points = inWindow.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - oldestMs) / dayMs,
    y: r.valueMgDl,
  }));

  const fit = linearRegression(points);
  if (fit === null) return null; // all timestamps identical
  if (fit.rSquared < TREND_R_SQUARED_GATE) return null;

  const absSlope = Math.abs(fit.slope);
  if (absSlope < TREND_NULL_SLOPE) return null;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (absSlope >= TREND_RAPID_SLOPE) {
    severityLevel = "critical";
    severityScore = 85;
    messageKey = "insight.trend.rapid";
  } else if (absSlope >= TREND_NOTABLE_SLOPE) {
    severityLevel = "warn";
    severityScore = 65;
    messageKey = "insight.trend.notable";
  } else {
    severityLevel = "info";
    severityScore = 45;
    messageKey = "insight.trend.slow";
  }

  // Confidence: R² is the natural anchor — a well-fit notable trend
  // (R² 0.7) should comfortably clear the 0.7 feed floor. Boost mildly
  // with data depth so a 5-point fit doesn't outrank a 30-point fit.
  const depthBoost = Math.min(1, inWindow.length / 14);
  const confidence = Math.min(1, fit.rSquared * (0.8 + 0.2 * depthBoost));

  return {
    patternType: "trend",
    conditionsInvolved: ["glucose"],
    severityScore,
    severityLevel,
    messageKey,
    messageParams: {
      direction: fit.slope > 0 ? "increasing" : "decreasing",
      slopePerDay: Math.round(fit.slope * 10) / 10,
      windowDays: input.windowDays,
      readingType: input.targetReadingType,
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
