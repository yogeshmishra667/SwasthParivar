// guardian-signal-aggregator — sums decayed signal contributions into a
// single 0-100 risk score and maps it to a severity band. Pure and
// deterministic: `now` is always a parameter, never `new Date()`.
//
// Decay: a signal is worth 0.5 ^ (ageDays / halflife) of its original
// contribution — 50% at the 7-day halflife (CLAUDE.md "Decay: 7d old =
// 50%"). Bands: 0-30 safe, 31-60 yellow, 61-100 orange (the 81+ red
// tier is reserved for Phase 4 and folds into orange for now).

import type { GuardianRiskBand } from "@swasth/shared-types";
import {
  RISK_BAND_ORANGE_MIN,
  RISK_BAND_YELLOW_MIN,
  SIGNAL_DECAY_HALFLIFE_DAYS,
  type AggregateRiskInput,
  type AggregateRiskResult,
} from "./types.js";

const DAY_MS = 86_400_000;

const bandFor = (score: number): GuardianRiskBand => {
  if (score >= RISK_BAND_ORANGE_MIN) return "orange";
  if (score >= RISK_BAND_YELLOW_MIN) return "yellow";
  return "safe";
};

export const aggregateRisk = (input: AggregateRiskInput): AggregateRiskResult => {
  const halflife = input.decayHalflifeDays ?? SIGNAL_DECAY_HALFLIFE_DAYS;
  const nowMs = input.now.getTime();

  let sum = 0;
  for (const signal of input.signals) {
    // A signal detected in the future (clock skew) is treated as
    // fresh — clamp age at 0 so decay never amplifies a contribution.
    const ageDays = Math.max(0, (nowMs - signal.detectedAt.getTime()) / DAY_MS);
    sum += signal.contribution * Math.pow(0.5, ageDays / halflife);
  }

  const totalScore = Math.max(0, Math.min(100, Math.round(sum)));
  return { totalScore, severity: bandFor(totalScore) };
};
