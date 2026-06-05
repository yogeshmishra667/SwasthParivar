import type { ExerciseTolerance, RhythmStatus } from "@swasth/shared-types";

export interface CardiacClassificationInput {
  /** Beats per minute. */
  heartRateBpm: number;
  /** Patient's self-reported rhythm. `unknown` is treated as a non-signal. */
  rhythmStatus: RhythmStatus;
  /** True if the patient is reporting chest pain on this log. */
  chestPain: boolean;
  /**
   * Numeric Rating Scale 0–10. `null` is treated as 0 — a patient who
   * reports chest pain but does not pick a severity is conservatively
   * classified as warn, not bypass. The service layer should never let a
   * `chestPain=true` reading reach the classifier without a severity,
   * but the pure function must remain defensive.
   */
  painSeverity: number | null;
  /** Self-reported tolerance for usual exertion. */
  exerciseTolerance: ExerciseTolerance;
}

/**
 * Stable identifiers for the precedence-ordered set of reasons the
 * classifier can return. The mobile / server layers map these to
 * i18n copy; never use them as user-visible text.
 */
export type CardiacClassificationReason =
  | "critical.hr_low"
  | "critical.hr_high"
  | "critical.chest_pain_severe"
  | "warn.hr_borderline_low"
  | "warn.hr_borderline_high"
  | "warn.chest_pain"
  | "warn.rhythm_irregular"
  | "warn.exercise_intolerance"
  | "normal";

export type CardiacSeverity = "normal" | "warn" | "critical_bypass";

export interface CardiacClassification {
  severity: CardiacSeverity;
  reason: CardiacClassificationReason;
  /**
   * All matched warn/critical reasons, in precedence order. The
   * top-level `reason` is `reasons[0]` (or `"normal"` when empty).
   * Surfaced for analytics + the warn-band UI banner, which renders
   * the full chip list rather than the top reason only.
   */
  reasons: readonly CardiacClassificationReason[];
}
