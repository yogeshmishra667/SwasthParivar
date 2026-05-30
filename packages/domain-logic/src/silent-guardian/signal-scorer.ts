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

// Phase 4 §C' — chat_sentiment.
//
// Evidence shape (filled in by the worker from the last 7d of chat
// retention sweep + safety-filter flags):
//   distressedTurns (number) — count of patient turns the safety
//                              filter marked distressed/concerned
//   totalTurns      (number) — denominator; used to compute density
//
// Two thin bands keeps the curve table-testable and avoids any free-
// text reasoning that could leak chat content into Sentry logs.
const scoreChatSentiment = (evidence: Readonly<Record<string, unknown>>): ScoredSignal => {
  const distressed = Math.max(0, Math.trunc(num(evidence, "distressedTurns", 0)));
  const total = Math.max(1, Math.trunc(num(evidence, "totalTurns", 1)));
  if (distressed === 0) {
    return {
      contribution: 0,
      signalType: "chat_sentiment_ok",
      reasoning: "no distressed turns in window",
    };
  }
  const density = distressed / total;
  let contribution: number;
  if (density >= 0.4 || distressed >= 4) contribution = 60;
  else if (density >= 0.2 || distressed >= 2) contribution = 40;
  else contribution = 25;
  return {
    contribution: clampScore(contribution),
    signalType: distressed >= 4 ? "chat_distress_persistent" : "chat_distress_present",
    reasoning: `${distressed} of ${total} chat turn(s) flagged distressed`,
  };
};

// Phase 4 §C' — schedule_miss.
//
// Evidence (filled in by the worker from HealthCheckCompliance):
//   missedSlots         (number)   — total missed in window
//   missedConsecutive   (number)   — longest run of consecutive misses
//                                    on a single schedule (most urgent)
//   checkType           (string)   — for the reasoning line; never used
//                                    for scoring
const scoreScheduleMiss = (evidence: Readonly<Record<string, unknown>>): ScoredSignal => {
  const missed = Math.max(0, Math.trunc(num(evidence, "missedSlots", 0)));
  const consecutive = Math.max(0, Math.trunc(num(evidence, "missedConsecutive", 0)));
  const rawCheckType = evidence.checkType;
  const checkType = typeof rawCheckType === "string" ? rawCheckType : "check";

  if (missed === 0) {
    return {
      contribution: 0,
      signalType: "schedule_compliant",
      reasoning: `${checkType} schedule on track`,
    };
  }

  // The consecutive run dominates — a single isolated miss is far
  // less urgent than three in a row.
  let contribution: number;
  if (consecutive >= 5) contribution = 70;
  else if (consecutive >= 3) contribution = 55;
  else if (consecutive >= 2 || missed >= 4) contribution = 38;
  else contribution = 22;

  return {
    contribution: clampScore(contribution),
    signalType: consecutive >= 3 ? "schedule_miss_streak" : "schedule_miss_isolated",
    reasoning: `${missed} missed ${checkType} slot(s); ${consecutive} consecutive`,
  };
};

// Phase 4 §C' — activity_drop (wired-but-dormant).
//
// Scorer branch exists for forward compatibility — the worker does
// NOT pull activity data until `ActivityDaily` lands in Feature I.
// When activity_drop_enabled flag goes on AND the table exists, the
// worker fills the evidence object and the scorer kicks in.
const scoreActivityDrop = (evidence: Readonly<Record<string, unknown>>): ScoredSignal => {
  const pctDrop = num(evidence, "pctDrop", 0); // 0..1
  if (pctDrop <= 0.2) {
    return {
      contribution: 0,
      signalType: "activity_ok",
      reasoning: "no meaningful activity drop",
    };
  }
  let contribution: number;
  if (pctDrop >= 0.6) contribution = 60;
  else if (pctDrop >= 0.4) contribution = 40;
  else contribution = 25;
  return {
    contribution: clampScore(contribution),
    signalType: pctDrop >= 0.6 ? "activity_drop_severe" : "activity_drop_present",
    reasoning: `activity ↓ ${Math.round(pctDrop * 100)}% vs baseline`,
  };
};

// Phase 4 §C' — cross_signal meta-signal.
//
// Fires when ≥ 2 of the OTHER signal sources contribute > 0 in the
// same analysis cycle. The contribution scales with how many distinct
// sources stacked. Evidence is the count of contributing sources +
// their list (for audit, never patient-facing).
const scoreCrossSignal = (evidence: Readonly<Record<string, unknown>>): ScoredSignal => {
  const sourceCount = Math.max(0, Math.trunc(num(evidence, "contributingSourceCount", 0)));
  if (sourceCount < 2) {
    return {
      contribution: 0,
      signalType: "cross_signal_none",
      reasoning: "fewer than 2 distinct sources fired",
    };
  }
  // The bonus is intentionally smaller than the underlying signals it
  // stacks on top of — the cross-signal is a "concerns are stacking"
  // nudge, not a primary risk driver.
  let contribution: number;
  if (sourceCount >= 4) contribution = 25;
  else if (sourceCount === 3) contribution = 18;
  else contribution = 12;
  return {
    contribution: clampScore(contribution),
    signalType: "cross_signal_stack",
    reasoning: `${sourceCount} distinct sources contributing this cycle`,
  };
};

export const scoreSignal = (input: SignalScorerInput): ScoredSignal => {
  switch (input.source) {
    case "med_adherence":
      return scoreMedAdherence(input.evidence);
    case "data_anomaly":
      return scoreDataAnomaly(input.evidence, input.userBaseline);
    case "chat_sentiment":
      return scoreChatSentiment(input.evidence);
    case "schedule_miss":
      return scoreScheduleMiss(input.evidence);
    case "activity_drop":
      return scoreActivityDrop(input.evidence);
    case "cross_signal":
      return scoreCrossSignal(input.evidence);
  }
};
