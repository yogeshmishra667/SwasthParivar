// guardian-alert-deduper — decides whether a candidate GuardianAlert
// should be pushed. Pure and deterministic.
//
// Two rules, both alert-fatigue protection (CLAUDE.md Alert Fatigue):
//   • yellow never pushes — it surfaces in the daily guardian summary.
//   • orange pushes at most MAX_ORANGE_ALERTS_PER_WEEK per rolling week
//     per guardian-patient pair.
//
// NOTE: the separate critical-bypass dedup (suppress a med-adherence
// orange when a critical-bypass already alerted the guardian in the
// last 30 min — phase3.md CC.11 §2) needs DB knowledge of bypass
// events and is enforced in the service layer, not here.

import {
  MAX_ORANGE_ALERTS_PER_WEEK,
  type DispatchDecision,
  type DispatchDecisionInput,
} from "./types.js";

const WEEK_MS = 7 * 86_400_000;

export const shouldDispatchAlert = (input: DispatchDecisionInput): DispatchDecision => {
  const { candidate } = input;

  if (candidate.severity === "yellow") {
    return {
      dispatch: false,
      reason: "yellow severity is delivered via the daily summary, not pushed",
    };
  }

  const nowMs = input.now.getTime();
  const orangeThisWeek = input.recentAlertsThisWeek.filter(
    (a) => a.severity === "orange" && nowMs - a.createdAt.getTime() < WEEK_MS,
  ).length;

  if (orangeThisWeek >= MAX_ORANGE_ALERTS_PER_WEEK) {
    return {
      dispatch: false,
      reason: `weekly orange cap reached (${orangeThisWeek}/${MAX_ORANGE_ALERTS_PER_WEEK}); ${candidate.type} alert held back`,
    };
  }

  return {
    dispatch: true,
    reason: `orange ${candidate.type} alert within the weekly cap (${orangeThisWeek}/${MAX_ORANGE_ALERTS_PER_WEEK})`,
  };
};
