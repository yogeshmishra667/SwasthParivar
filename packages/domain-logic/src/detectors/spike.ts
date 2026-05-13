// Spike detector — flags a single reading that sits far outside the
// patient's recent baseline for the *same* reading type. Glucose only
// in this phase; BP / cardiac variants come later.
//
// Spec (CLAUDE.md Insight Engine):
//   • 14-day rolling median + population stdDev
//   • Same reading_type only — never compare fasting to post_meal
//   • Severity bands by σ-distance from baseline:
//       mild         1.5σ ≤ d < 2σ   → info
//       significant  2σ   ≤ d < 3σ   → warn
//       severe       d ≥ 3σ          → critical
//     value > GLUCOSE_CRITICAL_HIGH (315) is *always* severe regardless
//     of σ (a 320 mg/dL reading is medically severe even with a wide
//     baseline).
//   • Min 7 days of same-type data (CLAUDE.md "Minimum Data").
//   • Confidence < 0.7 → caller stores but suppresses from the feed.
//     Mild spikes start at 0.6 confidence by design — they need a deep
//     data set to clear the floor.

import { GLUCOSE_CRITICAL_HIGH } from "@swasth/shared-types";
import { median, stdDev, daysBetween } from "./stats.js";
import type { DetectorResult, TypedReading } from "./types.js";

export interface SpikeDetectorInput {
  readings: readonly TypedReading[];
  // The reading we're testing — must be in `readings`. Detector returns
  // null if the target's type doesn't have enough same-type history.
  targetReadingId: string;
  targetReadingType: TypedReading["readingType"];
  now: Date;
}

const SPIKE_MILD_SIGMA = 1.5;
const SPIKE_SIGNIFICANT_SIGMA = 2;
const SPIKE_SEVERE_SIGMA = 3;
const SPIKE_MIN_DAYS = 7;
const SPIKE_WINDOW_DAYS = 14;

const dayMs = 86_400_000;

export const detectSpike = (input: SpikeDetectorInput): DetectorResult | null => {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - SPIKE_WINDOW_DAYS * dayMs;

  // Same-type filter is the medical-correctness rule — fasting baseline
  // never mixes with post_meal.
  const sameType = input.readings.filter(
    (r) => r.readingType === input.targetReadingType,
  );
  if (sameType.length === 0) return null;

  const target = sameType.find((r) => r.id === input.targetReadingId);
  if (!target) return null;

  // History excludes the target itself — we compare *against* prior
  // readings, not against the value we're flagging.
  const history = sameType.filter(
    (r) =>
      r.id !== input.targetReadingId &&
      new Date(r.measuredAt).getTime() >= windowStartMs &&
      new Date(r.measuredAt).getTime() <= nowMs,
  );

  if (history.length < 3) return null; // need a non-degenerate baseline

  // Minimum-data gate per CLAUDE.md: same-type readings must span ≥ 7d.
  const oldestMs = Math.min(
    ...history.map((r) => new Date(r.measuredAt).getTime()),
  );
  const span = daysBetween(oldestMs, nowMs);
  if (span < SPIKE_MIN_DAYS) return null;

  const values = history.map((r) => r.valueMgDl);
  const baseline = median(values);
  const sigma = stdDev(values);

  // Critical-high override: a single 320+ reading is always severe,
  // even if the patient's baseline is unusually wide.
  const valueExceedsCriticalHigh = target.valueMgDl > GLUCOSE_CRITICAL_HIGH;

  // Constant baseline → no σ-based spike concept; only the critical-high
  // override can fire here.
  if (sigma === 0 && !valueExceedsCriticalHigh) return null;

  const delta = target.valueMgDl - baseline;
  const sigmas = sigma === 0 ? 0 : Math.abs(delta) / sigma;

  if (!valueExceedsCriticalHigh && sigmas < SPIKE_MILD_SIGMA) return null;

  // Severity bands. Critical-high always promotes to severe.
  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  let messageKey: string;
  if (valueExceedsCriticalHigh || sigmas >= SPIKE_SEVERE_SIGMA) {
    severityLevel = "critical";
    severityScore = 90;
    messageKey = "insight.spike.severe";
  } else if (sigmas >= SPIKE_SIGNIFICANT_SIGMA) {
    severityLevel = "warn";
    severityScore = 70;
    messageKey = "insight.spike.significant";
  } else {
    severityLevel = "info";
    severityScore = 50;
    messageKey = "insight.spike.mild";
  }

  // Confidence: tiered floor + light data-depth lift. Severe spikes
  // ALWAYS clear the 0.7 feed floor (medically urgent — never hide).
  // Mild spikes start at 0.4 and only reach the floor with rich data,
  // so the average patient's noise doesn't pollute the feed.
  const dataDepth = Math.min(1, history.length / SPIKE_WINDOW_DAYS);
  let confidence: number;
  if (valueExceedsCriticalHigh || sigmas >= SPIKE_SEVERE_SIGMA) {
    confidence = 0.85 + 0.15 * dataDepth;
  } else if (sigmas >= SPIKE_SIGNIFICANT_SIGMA) {
    confidence = 0.7 + 0.15 * dataDepth;
  } else {
    confidence = 0.4 + 0.3 * dataDepth;
  }

  return {
    patternType: "spike",
    conditionsInvolved: ["glucose"],
    severityScore,
    severityLevel,
    messageKey,
    messageParams: {
      value: target.valueMgDl,
      baseline: Math.round(baseline),
      readingType: input.targetReadingType,
      sigmas: Math.round(sigmas * 10) / 10,
    },
    triggerReadings: [target.id],
    evidence: {
      baseline: Math.round(baseline),
      stdDev: Math.round(sigma * 100) / 100,
      sigmas: Math.round(sigmas * 100) / 100,
      sampleSize: history.length,
      windowDays: SPIKE_WINDOW_DAYS,
      criticalHighOverride: valueExceedsCriticalHigh,
    },
    confidence,
  };
};
