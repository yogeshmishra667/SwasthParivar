// Phase 4 Feature D' — pure contact selection per stage.
//
// Owns the rule "who do we try next, at this stage?" — independent of
// the dispatcher (which owns "how do we reach them"). Splitting these
// keeps the medical priority logic out of the I/O code and lets the
// tests assert ordering exhaustively.

import type { SOSContact, SOSContactSelectInput, SOSStage } from "./types.js";

const sortByPriority = (contacts: readonly SOSContact[]): readonly SOSContact[] =>
  [...contacts].sort((a, b) => {
    // Lower number wins (priority 1 first). Stable secondary sort on
    // id to keep equal-priority order deterministic across runs.
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

/** Which contacts are eligible for THIS stage. Phase 4 ship rules:
 *
 *   stage_0_fullscreen   → nobody (in-app only; the patient sees
 *                          the fullscreen alert, no remote dispatch
 *                          yet — this matches CLAUDE.md "Critical
 *                          Alert" where the in-app alert always
 *                          fires but external notification only
 *                          starts at the escalation stages).
 *   stage_1_auto_dial    → the priority-1 contact (one call attempt).
 *   stage_2_ivr_call     → walk through guardian-flagged contacts in
 *                          priority order (IVR each one).
 *   stage_3_all_contacts → every remaining contact, guardian or not.
 *   resolved / cancelled → nobody.
 *
 * Returns the SINGLE next contact to attempt. The dispatcher loops
 * `selectContactForStage` after each attempt, accumulating attempted
 * ids in `alreadyAttempted`, until this function returns `null`. At
 * that point the dispatcher advances the state machine. */
const eligibleForStage = (stage: SOSStage): "none" | "priority_1" | "guardians" | "all" => {
  switch (stage) {
    case "stage_0_fullscreen":
      return "none";
    case "stage_1_auto_dial":
      return "priority_1";
    case "stage_2_ivr_call":
      return "guardians";
    case "stage_3_all_contacts":
      return "all";
    case "resolved":
    case "cancelled":
      return "none";
  }
};

export const selectContactForStage = (input: SOSContactSelectInput): SOSContact | null => {
  const eligibility = eligibleForStage(input.stage);
  if (eligibility === "none") return null;
  if (input.contacts.length === 0) return null;

  const attempted = new Set(input.alreadyAttempted);
  const sorted = sortByPriority(input.contacts);

  if (eligibility === "priority_1") {
    // Stage 1 only ever tries ONE contact — the highest priority
    // one. If they were already attempted (because the dispatcher
    // tried them at this stage and got no answer) → return null so
    // the state machine advances to stage_2.
    const candidate = sorted[0];
    if (!candidate) return null;
    if (attempted.has(candidate.id)) return null;
    return candidate;
  }

  if (eligibility === "guardians") {
    for (const c of sorted) {
      if (!c.isGuardian) continue;
      if (attempted.has(c.id)) continue;
      return c;
    }
    return null;
  }

  // eligibility === "all"
  for (const c of sorted) {
    if (attempted.has(c.id)) continue;
    return c;
  }
  return null;
};

/** Convenience: return every contact a given stage WOULD attempt
 * (ignoring `alreadyAttempted`). Used by the integration test +
 * future mobile preview ("at stage 3, these N people will get
 * called"). */
export const eligibleContactsForStage = (
  stage: SOSStage,
  contacts: readonly SOSContact[],
): readonly SOSContact[] => {
  const eligibility = eligibleForStage(stage);
  if (eligibility === "none") return [];
  const sorted = sortByPriority(contacts);
  if (eligibility === "priority_1") {
    const first = sorted[0];
    return first ? [first] : [];
  }
  if (eligibility === "guardians") return sorted.filter((c) => c.isGuardian);
  return sorted;
};
