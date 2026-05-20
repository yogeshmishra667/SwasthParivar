// Cross-condition detector — glucose × BP correlation (phase3.md B.1 #1).
//
// Tests whether a patient's glucose runs higher on days their blood
// pressure is elevated. Welch's t-test (variance-unequal) on per-day
// mean glucose, split into "high-BP days" vs "normal-BP days".
//
// Spec (phase3.md B.1 / CLAUDE.md Insight Engine — cross-condition):
//   • Needs ≥ 30 days of *paired* (glucose + BP same day) data span.
//   • Needs ≥ 10 paired days in EACH group (high / normal).
//   • Significant only at p < 0.05 (configurable).
//   • Confidence ≥ 0.70 required — else return null (the feed floor;
//     a sub-0.70 pattern is stored-only, never surfaced).
//   • Fires only when high-BP days run HIGHER — the actionable
//     direction; a sub-10 mg/dL lift is noise (CLAUDE.md noise floor).
//
// Pure, IO-free; `now` is a parameter — never `new Date()` here.

import { mean, daysBetween } from "./stats.js";
import { welchTTest } from "./stats-helpers.js";
import type { DetectorResult, TypedBPReading, TypedReading } from "./types.js";

export interface CrossConditionInput {
  glucoseReadings: readonly TypedReading[];
  bpReadings: readonly TypedBPReading[];
  now: Date;
  /** Minimum paired-data span in days (default 30). */
  minDays?: number;
  /** Significance threshold (default 0.05). */
  pValueThreshold?: number;
}

const DEFAULT_MIN_DAYS = 30;
const DEFAULT_P_THRESHOLD = 0.05;
const MIN_PAIRS_PER_GROUP = 10;
// Stage-2 hypertension systolic boundary — a day is "high BP" if any
// BP reading that day is at or above this.
const HIGH_BP_SYSTOLIC = 140;
const CONFIDENCE_FLOOR = 0.7;

// Effect-size thresholds: mean glucose lift (mg/dL) on high-BP days.
// Below INFO_DELTA is noise (CLAUDE.md "Delta < 10 → always neutral").
const INFO_DELTA = 10;
const WARN_DELTA = 20;
const CRITICAL_DELTA = 35;

// UTC calendar-day key. Detectors are UTC-deterministic; IST-boundary
// nuance is unnecessary for a 30-day correlation window.
const dayKey = (iso: string): string => iso.slice(0, 10);

interface DayGlucose {
  values: number[];
  ids: string[];
}

export const detectCrossCondition = (input: CrossConditionInput): DetectorResult | null => {
  const minDays = input.minDays ?? DEFAULT_MIN_DAYS;
  const pThreshold = input.pValueThreshold ?? DEFAULT_P_THRESHOLD;
  const nowMs = input.now.getTime();

  // Glucose grouped by UTC day.
  const glucoseByDay = new Map<string, DayGlucose>();
  for (const g of input.glucoseReadings) {
    const k = dayKey(g.measuredAt);
    const entry = glucoseByDay.get(k) ?? { values: [], ids: [] };
    entry.values.push(g.valueMgDl);
    entry.ids.push(g.id);
    glucoseByDay.set(k, entry);
  }

  // Each day with a BP reading → high if any systolic ≥ threshold.
  const bpHighByDay = new Map<string, boolean>();
  for (const bp of input.bpReadings) {
    const k = dayKey(bp.measuredAt);
    const prev = bpHighByDay.get(k) ?? false;
    bpHighByDay.set(k, prev || bp.systolic >= HIGH_BP_SYSTOLIC);
  }

  // Paired days — a day with both a glucose reading and a BP reading.
  const highGroup: number[] = [];
  const normalGroup: number[] = [];
  const highDayReadingIds: string[] = [];
  const pairedDayMs: number[] = [];
  for (const [k, glucose] of glucoseByDay) {
    const high = bpHighByDay.get(k);
    if (high === undefined) continue;
    const dayMean = mean(glucose.values);
    if (high) {
      highGroup.push(dayMean);
      highDayReadingIds.push(...glucose.ids);
    } else {
      normalGroup.push(dayMean);
    }
    pairedDayMs.push(new Date(k).getTime());
  }

  // Sparsity gate — enough paired days in each group.
  if (highGroup.length < MIN_PAIRS_PER_GROUP || normalGroup.length < MIN_PAIRS_PER_GROUP) {
    return null;
  }

  // Span gate — paired data must cover at least `minDays` calendar days.
  const earliestMs = Math.min(...pairedDayMs);
  if (daysBetween(earliestMs, nowMs) < minDays) return null;

  // Significance gate — Welch's t-test.
  const tt = welchTTest(highGroup, normalGroup);
  if (tt === null || tt.pValue >= pThreshold) return null;

  const highMean = mean(highGroup);
  const normalMean = mean(normalGroup);
  const delta = highMean - normalMean;
  // Direction + noise gate — only a meaningful upward lift is actionable.
  if (delta < INFO_DELTA) return null;

  // Confidence blends statistical significance, effect size, and sample
  // depth, so a significant-but-tiny effect on few days stays below the
  // 0.70 feed floor.
  const effectScale = Math.min(1, delta / CRITICAL_DELTA);
  const sampleScale = Math.min(1, (highGroup.length + normalGroup.length) / 60);
  const confidence = Math.min(1, 0.5 * (1 - tt.pValue) + 0.3 * effectScale + 0.2 * sampleScale);
  if (confidence < CONFIDENCE_FLOOR) return null;

  let severityLevel: DetectorResult["severityLevel"];
  let severityScore: number;
  if (delta >= CRITICAL_DELTA) {
    severityLevel = "critical";
    severityScore = 80;
  } else if (delta >= WARN_DELTA) {
    severityLevel = "warn";
    severityScore = 60;
  } else {
    severityLevel = "info";
    severityScore = 40;
  }

  return {
    patternType: "cross_condition",
    conditionsInvolved: ["glucose", "bp"],
    severityScore,
    severityLevel,
    messageKey: `insight.cross_condition.${severityLevel}`,
    messageParams: {
      highBpMean: Math.round(highMean),
      normalBpMean: Math.round(normalMean),
      delta: Math.round(delta),
      systolicThreshold: HIGH_BP_SYSTOLIC,
    },
    triggerReadings: highDayReadingIds,
    evidence: {
      highBpDays: highGroup.length,
      normalBpDays: normalGroup.length,
      highBpMean: Math.round(highMean * 10) / 10,
      normalBpMean: Math.round(normalMean * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      pValue: Math.round(tt.pValue * 10_000) / 10_000,
      systolicThreshold: HIGH_BP_SYSTOLIC,
    },
    confidence: Math.round(confidence * 100) / 100,
  };
};
