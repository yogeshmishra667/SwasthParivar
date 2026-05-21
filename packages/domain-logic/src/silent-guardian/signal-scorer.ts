// guardian-signal-scorer — turns one detected concern into a 0-100 risk
// contribution. Pure, deterministic, total: every code path returns a
// ScoredSignal and the function never throws, even on malformed
// evidence (values arrive as `unknown` from a JSON column).
//
// Phase 3 scope = two signal sources only (CLAUDE.md / phase3.md C):
//   • med_adherence — missed medication doses in the analysis window
//   • data_anomaly  — a worsening glucose trend (from the trend detector)

import type { ScoredSignal, SignalScorerInput } from "./types.js";

const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

// Defensive numeric read — a missing or non-finite value yields the
// fallback so the scorer stays total.
const num = (
  evidence: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number => {
  const v = evidence[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

// Missed-dose count → contribution. Piecewise so it is exhaustively
// table-testable: one miss is yellow-grade, three is orange-grade on
// its own, and the curve flattens past four (already maximally urgent).
const medContribution = (missedCount: number): number => {
  if (missedCount <= 0) return 0;
  if (missedCount === 1) return 30;
  if (missedCount === 2) return 50;
  if (missedCount === 3) return 65;
  if (missedCount === 4) return 78;
  return 88;
};

const scoreMedAdherence = (evidence: Readonly<Record<string, unknown>>): ScoredSignal => {
  const missedCount = Math.max(0, Math.trunc(num(evidence, "missedCount", 0)));
  const windowDays = Math.max(1, Math.trunc(num(evidence, "windowDays", 7)));

  const contribution = medContribution(missedCount);

  const signalType =
    missedCount === 0
      ? "med_adherence_ok"
      : missedCount >= 3
        ? "med_missed_frequent"
        : "med_missed_occasional";

  return {
    contribution: clampScore(contribution),
    signalType,
    reasoning: `${missedCount} missed dose(s) over ${windowDays}d`,
  };
};

// Worsening-trend slope bands, in mg/dL per day. Mirrors the trend
// detector's own thresholds (notable ≥ 2, rapid ≥ 5) so the two stay
// consistent.
const TREND_NOTABLE_SLOPE = 2;
const TREND_RAPID_SLOPE = 5;

const scoreDataAnomaly = (
  evidence: Readonly<Record<string, unknown>>,
  userBaseline: SignalScorerInput["userBaseline"],
): ScoredSignal => {
  const slopePerDay = num(evidence, "slopePerDay", 0);
  const rSquared = num(evidence, "rSquared", 0);
  const rawReadingType = evidence.readingType;
  const readingType = typeof rawReadingType === "string" ? rawReadingType : "glucose";
  const absSlope = Math.abs(slopePerDay);

  // For glucose a RISING trend is the concern. The trend detector
  // labels direction "increasing" / "decreasing"; when that label is
  // absent fall back to the slope sign. An improving (falling) or flat
  // trend contributes nothing.
  const direction = evidence.direction;
  const rising = direction === "increasing" || (direction === undefined && slopePerDay > 0);

  if (!rising || absSlope < 1) {
    return {
      contribution: 0,
      signalType: "trend_stable",
      reasoning: `${readingType} trend is not a concern`,
    };
  }

  let contribution: number;
  if (absSlope >= TREND_RAPID_SLOPE) contribution = 72;
  else if (absSlope >= TREND_NOTABLE_SLOPE) contribution = 55;
  else contribution = 35;

  // A rise that is large relative to the patient's own variability is
  // more urgent — a stable patient destabilising beats noise in an
  // already-volatile one.
  if (userBaseline !== null && userBaseline.sigma > 0 && absSlope / userBaseline.sigma >= 1) {
    contribution += 10;
  }
  // A weak regression fit means a scattered, less certain trend.
  if (rSquared > 0 && rSquared < 0.6) {
    contribution -= 8;
  }

  return {
    contribution: clampScore(contribution),
    signalType: absSlope >= TREND_RAPID_SLOPE ? "worsening_trend_rapid" : "worsening_trend",
    reasoning: `${readingType} rising ~${absSlope} mg/dL/day`,
  };
};

export const scoreSignal = (input: SignalScorerInput): ScoredSignal => {
  switch (input.source) {
    case "med_adherence":
      return scoreMedAdherence(input.evidence);
    case "data_anomaly":
      return scoreDataAnomaly(input.evidence, input.userBaseline);
  }
};
