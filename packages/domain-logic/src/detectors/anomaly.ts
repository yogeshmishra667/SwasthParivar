// Anomaly detector — flags readings that sit outside the patient's
// Tukey fences over a 21-day window. Robust to outliers in the
// baseline itself (CLAUDE.md mandates median + IQR over mean + σ
// specifically because we're trying to flag outliers).
//
// Spec (CLAUDE.md Insight Engine):
//   • median + IQR (NOT mean + σ)
//   • Min 21 days of data
//   • Same reading_type only
//   • Tukey fences: outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]
//
// How this differs from `detectSpike`:
//   • spike uses σ from a 14-day window (sensitive to noise)
//   • anomaly uses IQR from a 21-day window (robust)
//   • A reading can fire one detector but not the other — both feed
//     the InsightEvent table; the UI dedupes on (patternType, day).

import { iqr, daysBetween } from "./stats.js";
import type { DetectorResult, TypedReading } from "./types.js";

export interface AnomalyDetectorInput {
  readings: readonly TypedReading[];
  targetReadingId: string;
  targetReadingType: TypedReading["readingType"];
  now: Date;
}

const dayMs = 86_400_000;
const ANOMALY_WINDOW_DAYS = 21;
const ANOMALY_MIN_DAYS = 21;
const TUKEY_K = 1.5;
const TUKEY_K_EXTREME = 3;

export const detectAnomaly = (input: AnomalyDetectorInput): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - ANOMALY_WINDOW_DAYS * dayMs;

  const sameType = input.readings.filter((r) => r.readingType === input.targetReadingType);
  if (sameType.length === 0) return null;

  const target = sameType.find((r) => r.id === input.targetReadingId);
  if (!target) return null;

  // History excludes the target — we test against prior readings.
  const history = sameType.filter(
    (r) =>
      r.id !== input.targetReadingId &&
      new Date(r.measuredAt).getTime() >= windowStartMs &&
      new Date(r.measuredAt).getTime() <= nowMs,
  );

  if (history.length < 5) return null;

  // Minimum-data gate per CLAUDE.md: 21 days of same-type data.
  const oldestMs = Math.min(...history.map((r) => new Date(r.measuredAt).getTime()));
  if (daysBetween(oldestMs, nowMs) < ANOMALY_MIN_DAYS) return null;

  const { q1, q3, iqr: iqrValue } = iqr(history.map((r) => r.valueMgDl));

  // Constant baseline (iqr=0) → no fence concept; only an exact
  // boundary mismatch would even register. Return null rather than
  // divide by zero or produce spurious "anomaly".
  if (iqrValue === 0) return null;

  const lowerFence = q1 - TUKEY_K * iqrValue;
  const upperFence = q3 + TUKEY_K * iqrValue;
  const extremeLowerFence = q1 - TUKEY_K_EXTREME * iqrValue;
  const extremeUpperFence = q3 + TUKEY_K_EXTREME * iqrValue;

  const value = target.valueMgDl;
  const insideFences = value >= lowerFence && value <= upperFence;
  if (insideFences) return null;

  const isExtreme = value < extremeLowerFence || value > extremeUpperFence;
  const direction = value < lowerFence ? "low" : "high";

  // Severity: mild outlier → warn; extreme (≥ 3*IQR outside) → critical.
  // No "info" band — by definition an anomaly is at minimum unusual.
  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (isExtreme) {
    severityLevel = "critical";
    severityScore = 85;
    messageKey = `insight.anomaly.extreme_${direction}`;
  } else {
    severityLevel = "warn";
    severityScore = 65;
    messageKey = `insight.anomaly.${direction}`;
  }

  // Distance in IQR-units — used in evidence + confidence.
  const distanceIqrs = direction === "high" ? (value - q3) / iqrValue : (q1 - value) / iqrValue;

  // Confidence: anchored on distance from the fence + sample size.
  // 5-point minimum baseline → 0.5 depth boost; full 21-day window →
  // 1.0. Extreme anomalies clear 0.7 even with thin data.
  const dataDepth = Math.min(1, history.length / 21);
  const distanceFactor = Math.min(1, distanceIqrs / 4);
  const base = isExtreme ? 0.8 : 0.55;
  const confidence = Math.min(1, base + 0.15 * dataDepth + 0.1 * distanceFactor);

  return {
    patternType: "anomaly",
    conditionsInvolved: ["glucose"],
    severityScore,
    severityLevel,
    messageKey,
    messageParams: {
      value,
      direction,
      readingType: input.targetReadingType,
      iqrDistance: Math.round(distanceIqrs * 10) / 10,
    },
    triggerReadings: [target.id],
    evidence: {
      q1: Math.round(q1 * 10) / 10,
      q3: Math.round(q3 * 10) / 10,
      iqr: Math.round(iqrValue * 10) / 10,
      lowerFence: Math.round(lowerFence * 10) / 10,
      upperFence: Math.round(upperFence * 10) / 10,
      distanceIqrs: Math.round(distanceIqrs * 100) / 100,
      sampleSize: history.length,
      windowDays: ANOMALY_WINDOW_DAYS,
      extreme: isExtreme,
    },
    confidence,
  };
};
