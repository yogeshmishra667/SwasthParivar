// Phase 3 Feature C — Silent Guardian pure-domain-logic types.
//
// These are the input/output shapes for the five pure functions in
// this folder plus their tuning constants. Cross-cutting string unions
// (SignalSource, GuardianAlertType, …) live in @swasth/shared-types so
// server + mobile + domain-logic agree; the structural shapes below
// stay local because they mirror Prisma rows minus DB-internal fields —
// the caller (a server service / worker) maps Prisma rows to these at
// the service boundary so every function in this folder stays pure.

import type {
  GuardianAlertSeverity,
  GuardianAlertType,
  GuardianRiskBand,
  SignalSource,
} from "@swasth/shared-types";

// ---------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------

// A signal's contribution decays exponentially; it is worth 50% of its
// original weight after this many days. CLAUDE.md Silent Guardian:
// "Decay: 7d old = 50%".
export const SIGNAL_DECAY_HALFLIFE_DAYS = 7 as const;

// Hard cap on ORANGE alerts per guardian-patient pair per rolling week.
// CLAUDE.md Alert Fatigue: "Orange max 2/week".
export const MAX_ORANGE_ALERTS_PER_WEEK = 2 as const;

// Aggregate-risk band thresholds (inclusive lower bounds). CLAUDE.md
// Silent Guardian scoring: 0-30 safe, 31-60 yellow, 61-80 orange,
// 81-100 reserved for a red tier (Phase 4). In Phase 3 there is no red
// tier, so the 81+ range maps to orange — the highest band that exists.
export const RISK_BAND_YELLOW_MIN = 31 as const;
export const RISK_BAND_ORANGE_MIN = 61 as const;

// ---------------------------------------------------------------------
// scoreSignal — guardian-signal-scorer
// ---------------------------------------------------------------------

export interface SignalScorerInput {
  source: SignalSource;
  // Structured numeric evidence from the analysis window. Read
  // defensively (values arrive as `unknown` from a JSON column) — the
  // scorer is total and never throws.
  //   med_adherence: { missedCount, windowDays? }
  //   data_anomaly:  { slopePerDay, direction?, rSquared?, readingType? }
  //                  (direction / slope sign per the trend detector)
  evidence: Readonly<Record<string, unknown>>;
  // The patient's own glucose baseline, when enough history exists.
  // Used by data_anomaly to weigh a trend against the patient's normal
  // day-to-day variability. `null` when unknown.
  userBaseline: { mean: number; sigma: number } | null;
}

export interface ScoredSignal {
  // 0-100. The signal's contribution to aggregate risk BEFORE decay.
  contribution: number;
  // Stable machine string, e.g. "med_missed_frequent",
  // "worsening_trend". Stored as SilentGuardianSignal.signalType.
  signalType: string;
  // Short structured-data-derived note. Audit/debug only — never
  // patient-facing copy, never contains free-text input.
  reasoning: string;
}

// ---------------------------------------------------------------------
// aggregateRisk — guardian-signal-aggregator
// ---------------------------------------------------------------------

export interface RiskSignal {
  contribution: number;
  detectedAt: Date;
}

export interface AggregateRiskInput {
  signals: readonly RiskSignal[];
  now: Date;
  // Defaults to SIGNAL_DECAY_HALFLIFE_DAYS.
  decayHalflifeDays?: number;
}

export interface AggregateRiskResult {
  totalScore: number; // 0-100, decayed sum clamped
  severity: GuardianRiskBand;
}

// ---------------------------------------------------------------------
// shouldDispatchAlert — guardian-alert-deduper
// ---------------------------------------------------------------------

// Minimal shape of a prior GuardianAlert the deduper needs. The caller
// maps Prisma rows to this at the service boundary.
export interface RecentAlertRecord {
  severity: GuardianAlertSeverity;
  createdAt: Date;
}

export interface DispatchDecisionInput {
  candidate: { severity: GuardianAlertSeverity; type: GuardianAlertType };
  // Alerts already created for this guardian-patient pair. The deduper
  // re-filters to the rolling 7-day window itself, so an over-broad
  // list is safe to pass.
  recentAlertsThisWeek: readonly RecentAlertRecord[];
  now: Date;
}

export interface DispatchDecision {
  dispatch: boolean;
  reason: string;
}

// ---------------------------------------------------------------------
// buildAlertContent — guardian-alert-explainer
// ---------------------------------------------------------------------

export type AlertLanguage = "hi" | "en" | "hi-en";

// Minimal signal shape the explainer consumes. `rawEvidence` is read
// for NUMERIC fields only — the explainer NEVER echoes a string value
// into patient-facing copy (PII / verbatim-chat-content safety).
export interface AlertContentSignal {
  source: SignalSource;
  signalType: string;
  rawEvidence: Readonly<Record<string, unknown>>;
}

export interface AlertContentInput {
  signals: readonly AlertContentSignal[];
  // The only free-text value allowed into the output copy.
  patientName: string;
  language: AlertLanguage;
}

export interface AlertContent {
  title: string;
  summary: string; // 1-line
  explanation: string; // WHY this fired — never just a score
  suggestedAction: string; // WHAT the guardian should do
}

// ---------------------------------------------------------------------
// sortPatientsByUrgency — guardian-multi-patient-sort
// ---------------------------------------------------------------------

export interface PatientUrgency {
  id: string;
  latestAlertSeverity: GuardianRiskBand;
  // Minutes since the patient's most recent alert. Smaller = fresher.
  alertAgeMin: number;
}

export interface MultiPatientSortInput {
  patients: readonly PatientUrgency[];
}
