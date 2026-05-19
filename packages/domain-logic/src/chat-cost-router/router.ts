import type { ChatCostTier, ChatIntent } from "@swasth/shared-types";

// 3-tier cost router (phase3.md A.2). Pure decision function: given
// the incoming request shape, pick which response tier to use.
//
// Target distribution on synthetic traffic: ~60% template / ~20%
// cached / ~20% sonnet. Tracked in PostHog via
// `ai_chat_response_generated{tier}` so we can verify the live mix.
//
// Priority chain (first match wins):
//   1. medication_question intent → always `template`. Safety rule —
//      Claude must never answer medication questions directly; the
//      template layer redirects every such question to "ask the
//      doctor" (handled by chat-template-responses).
//   2. Cached hit (history matches a previous Q+A) → `cached`. The
//      cheapest non-static answer.
//   3. Cold-start / data-sparse user → `template`. <14 days of usage
//      or <5 readings: Claude has nothing patient-specific to add.
//   4. Deterministic intents (`data_explainer`, `lifestyle`) →
//      `template`. Definitions and generic tips don't need an LLM.
//   5. Reasoning intents (`reading_summary`, `open_ended`) → `sonnet`.
//   6. Default → `template` (fail closed, cheapest).
//
// Coverage target: 100% branches (phase3.md A.9). Every priority step
// is exercised by router.test.ts.

export interface CostTierInput {
  intent: ChatIntent;
  userStageDays: number;
  readingsAvailable: number;
  historyMatch: boolean;
}

// Thresholds documented inline above. Externalised as named constants
// so router.test.ts can pin the boundary cases instead of magic numbers.
export const COLD_START_DAY_THRESHOLD = 14 as const;
export const MIN_READINGS_FOR_PERSONALISATION = 5 as const;

export const pickCostTier = (input: CostTierInput): ChatCostTier => {
  if (input.intent === "medication_question") return "template";
  if (input.historyMatch) return "cached";
  if (
    input.userStageDays < COLD_START_DAY_THRESHOLD ||
    input.readingsAvailable < MIN_READINGS_FOR_PERSONALISATION
  ) {
    return "template";
  }
  if (input.intent === "data_explainer" || input.intent === "lifestyle") return "template";
  if (input.intent === "reading_summary" || input.intent === "open_ended") return "sonnet";
  return "template";
};
