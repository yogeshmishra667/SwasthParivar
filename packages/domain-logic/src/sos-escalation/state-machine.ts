// Phase 4 Feature D' — SOS escalation state machine.
//
// Safety-critical (100% branch coverage locked in vitest.config.ts).
// Pure function: input → next-stage. The companion BullMQ processor
// owns time advancement, side effects (push/SMS/IVR), and DB writes.
//
// Monotonic: the chain only ever moves forward through the numbered
// stages or jumps to a terminal (`resolved` / `cancelled`). It NEVER
// regresses to an earlier numbered stage. Re-running the function
// with the same input is idempotent — safe to call from a re-delivered
// BullMQ job.
//
// Precedence (highest first; first match wins):
//   1. resolved              → resolved
//   2. externallyCancelled   → cancelled
//   3. patientCancelled      → cancelled  (only meaningful at stage_0)
//   4. anyContactAnsweredCall → resolved   (a reached contact = success)
//   5. timeout transitions   → next numbered stage
//   6. (no change)

import {
  SOS_ALL_CONTACTS_AFTER_SECONDS,
  SOS_AUTO_DIAL_AFTER_SECONDS,
  SOS_IVR_AFTER_SECONDS,
  type SOSStage,
  type SOSStateInput,
  type SOSTransitionResult,
} from "./types.js";

/** Stages that the chain can have moved on from. Terminal stages
 * always short-circuit to `no_change`. */
const isTerminal = (s: SOSStage): boolean => s === "resolved" || s === "cancelled";

const sameStage = (s: SOSStage): SOSTransitionResult => ({
  nextStage: s,
  changed: false,
  reason: "no_change",
});

/**
 * Compute the next escalation stage given the current state + time +
 * external signals.
 *
 * Inputs / outputs are intentionally narrow so this can be re-used
 * from the BullMQ processor, an integration test, and a future
 * mobile-side state preview (the mobile screen can predict when the
 * dialer will fire without round-tripping the server).
 */
export const nextSOSStage = (input: SOSStateInput): SOSTransitionResult => {
  // Terminal states are sticky. Once resolved/cancelled the row is
  // immutable — the processor stops scheduling itself.
  if (isTerminal(input.currentStage)) return sameStage(input.currentStage);

  // 1. Resolved signal wins over everything else. The /resolve
  //    endpoint sets `resolvedAt` and the processor passes that
  //    through as `resolved=true`.
  if (input.resolved) {
    return { nextStage: "resolved", changed: true, reason: "resolved" };
  }

  // 2 & 3. Cancel signals. `externallyCancelled` outranks
  //    `patientCancelled` because the external cancel came from a
  //    different actor (guardian / ops) — preserve the audit
  //    distinction in the `reason` for PostHog.
  if (input.externallyCancelled) {
    return { nextStage: "cancelled", changed: true, reason: "cancelled_external" };
  }
  if (input.patientCancelled) {
    return { nextStage: "cancelled", changed: true, reason: "cancelled_by_patient" };
  }

  // 4. Any contact answered an outgoing call. The dispatcher records
  //    this on `SOSEvent.contactsNotified[].ivrAnswered`; the
  //    processor lifts it onto the input. A reached human = success;
  //    end the chain.
  if (input.anyContactAnsweredCall) {
    return { nextStage: "resolved", changed: true, reason: "contact_answered" };
  }

  // 5. Timeout-driven monotonic forward steps. Each stage advances
  //    when the elapsed clock crosses its threshold. We check from
  //    the END (latest threshold) so a slightly-late cron tick
  //    skips intermediate stages rather than walking them one tick
  //    at a time. That matters: in a real emergency the chain MUST
  //    catch up to "where it should be" on a single tick.
  const elapsed = input.elapsedSecondsSinceTrigger;

  if (input.currentStage === "stage_2_ivr_call" && elapsed >= SOS_ALL_CONTACTS_AFTER_SECONDS) {
    return {
      nextStage: "stage_3_all_contacts",
      changed: true,
      reason: "all_contacts_timeout",
    };
  }

  if (input.currentStage === "stage_1_auto_dial" && elapsed >= SOS_IVR_AFTER_SECONDS) {
    return { nextStage: "stage_2_ivr_call", changed: true, reason: "ivr_timeout" };
  }

  if (input.currentStage === "stage_0_fullscreen" && elapsed >= SOS_AUTO_DIAL_AFTER_SECONDS) {
    return { nextStage: "stage_1_auto_dial", changed: true, reason: "auto_dial_timeout" };
  }

  return sameStage(input.currentStage);
};

/** Helper for the processor: should the chain keep ticking? Returns
 * false when the stage is terminal — the worker uses this to decide
 * whether to re-schedule its next tick. */
export const isSOSChainActive = (stage: SOSStage): boolean => !isTerminal(stage);
