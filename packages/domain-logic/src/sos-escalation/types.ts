// Phase 4 Feature D' — SOS escalation pure types.
//
// All escalation logic lives in pure modules so the safety-critical
// transitions can be exhaustively tested without booting BullMQ. The
// caller (sos-escalation processor) is responsible for advancing time
// and side effects; this module owns the WHAT, not the WHEN.

/** The state-machine states. Mirrors the Prisma `SOSEscalationStage`
 * enum 1:1; kept local so domain-logic stays Prisma-free. */
export type SOSStage =
  | "stage_0_fullscreen"
  | "stage_1_auto_dial"
  | "stage_2_ivr_call"
  | "stage_3_all_contacts"
  | "resolved"
  | "cancelled";

/** Trigger source. Phase 4 ships `patient_manual` only; the other two
 * routes are flagged off until §D'.2 lands. */
export type SOSTriggerSource =
  | "patient_manual"
  | "critical_bypass_escalation"
  | "guardian_initiated";

/** Per-stage timing constants (seconds since trigger). The cron tick
 * interval is finer than these thresholds, so a slightly-late tick
 * never skips a transition — `nextSOSStage` is monotonic and
 * idempotent on re-call.
 *
 * Values are exported so the integration tests + the SOS service
 * share a single source of truth. The phase3.md spec calls for 60s
 * to auto-dial and 5min to IVR; stage_3 is a generous 10min fallback
 * for the dead-mans-switch broadcast. */
export const SOS_AUTO_DIAL_AFTER_SECONDS = 60;
export const SOS_IVR_AFTER_SECONDS = 300;
export const SOS_ALL_CONTACTS_AFTER_SECONDS = 600;

/** Input to the pure transition function. Time is passed in (no
 * `Date.now()` inside the module) so the same input always produces
 * the same output. */
export interface SOSStateInput {
  readonly currentStage: SOSStage;
  readonly elapsedSecondsSinceTrigger: number;
  /** Patient hit "I'm OK" on the fullscreen alert. Stops the chain
   * at stage_0 — the explicit cancel signal. */
  readonly patientCancelled: boolean;
  /** Any guardian / emergency contact picked up an outgoing IVR or
   * answered a call. Stops the chain — they have the situation. */
  readonly anyContactAnsweredCall: boolean;
  /** Set true by the resolve endpoint (patient/guardian/ops). */
  readonly resolved: boolean;
  /** Set true by the cancel endpoint when the cancel came from
   * outside stage_0 (rare — guardian cancels a chain in progress). */
  readonly externallyCancelled: boolean;
}

/** Why a transition happened (or why it didn't). Useful for audit +
 * PostHog events. The integers double as priority — a higher value
 * outranks a lower one if multiple transitions could fire. */
export type SOSTransitionReason =
  | "resolved"
  | "cancelled_by_patient"
  | "cancelled_external"
  | "contact_answered"
  | "auto_dial_timeout"
  | "ivr_timeout"
  | "all_contacts_timeout"
  | "no_change";

export interface SOSTransitionResult {
  readonly nextStage: SOSStage;
  readonly changed: boolean;
  readonly reason: SOSTransitionReason;
}

// ── Contact resolution ────────────────────────────────────────────

/** The minimum contact shape the resolver needs. Mirrors the Prisma
 * `EmergencyContact` model but local-only. */
export interface SOSContact {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  /** Lower number = higher priority. */
  readonly priority: number;
  readonly isGuardian: boolean;
}

/** Per-stage contact selection input. Returned contact is the next
 * one to attempt; `null` means "nobody left at this stage" → the
 * caller should advance the state machine. */
export interface SOSContactSelectInput {
  readonly stage: SOSStage;
  readonly contacts: readonly SOSContact[];
  readonly alreadyAttempted: readonly string[];
}

// ── Message copy ─────────────────────────────────────────────────

/** Patient's preferred language at trigger time. Snapshotted on the
 * SOSEvent row in Phase 4 §D'.2 (not yet — the column lives on
 * `User` for now). Default `hi` per CLAUDE.md. */
export type SOSLanguage = "hi" | "en";

export interface SOSMessageInput {
  readonly patientName: string;
  readonly language: SOSLanguage;
  /** Optional last-known location URL (Google Maps deep link).
   * Snapshotted at trigger time on the SOSEvent row. */
  readonly locationUrl?: string;
  /** Optional one-line context — e.g. "Sugar: 38 mg/dL (10 min ago)".
   * The dispatcher builds this from `SOSEvent.lastReadings`. */
  readonly contextSummary?: string;
}

export interface SOSMessage {
  /** SMS body. Capped at 459 chars (3-segment SMS) so the message
   * never gets dropped by the carrier mid-emergency. */
  readonly sms: string;
  /** IVR script — spoken via Exotel/Twilio TTS. Same content, more
   * formal phrasing (no emoji, full sentences). */
  readonly ivrScript: string;
}
