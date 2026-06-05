import {
  CHEST_PAIN_CRITICAL_SEVERITY,
  HR_CRITICAL_HIGH,
  HR_CRITICAL_LOW,
} from "@swasth/shared-types";
import type {
  CardiacClassification,
  CardiacClassificationInput,
  CardiacClassificationReason,
} from "./types.js";

/**
 * Borderline warn bands sit immediately outside the critical thresholds.
 * 40–49 bpm and 121–150 bpm are clinically "be careful" but never on
 * their own trigger the bypass chain. Exported so the mobile UI can
 * render the same bands as the classifier (no drift between server and
 * client copy).
 */
export const HR_WARN_LOW_INCLUSIVE = HR_CRITICAL_LOW;
export const HR_WARN_LOW_EXCLUSIVE_UPPER = 50 as const;
export const HR_WARN_HIGH_INCLUSIVE = 121 as const;
export const HR_WARN_HIGH_INCLUSIVE_UPPER = HR_CRITICAL_HIGH;

/**
 * Pure classifier for a single cardiac reading.
 *
 * Decision precedence (first match wins for `severity`; all matches are
 * accumulated in `reasons`):
 *
 *   1. Critical-bypass (any one is enough):
 *      - HR < {@link HR_CRITICAL_LOW}
 *      - HR > {@link HR_CRITICAL_HIGH}
 *      - chestPain && severity ≥ {@link CHEST_PAIN_CRITICAL_SEVERITY}
 *   2. Warn band (any one):
 *      - HR in {@link HR_WARN_LOW_INCLUSIVE} – {@link HR_WARN_LOW_EXCLUSIVE_UPPER}
 *      - HR in {@link HR_WARN_HIGH_INCLUSIVE} – {@link HR_WARN_HIGH_INCLUSIVE_UPPER}
 *      - chestPain (any severity below the critical floor)
 *      - rhythmStatus === "irregular"
 *      - exerciseTolerance ∈ {"reduced", "severe"}
 *   3. Otherwise normal.
 *
 * Pure — no I/O, no `Date.now()`, no Math.random. Deterministic for a
 * given input shape; safe to call in any context including the BullMQ
 * worker, the HTTP request path, and the mobile pre-save preview.
 */
export const classifyCardiacReading = (
  input: CardiacClassificationInput,
): CardiacClassification => {
  const reasons: CardiacClassificationReason[] = [];

  const hr = input.heartRateBpm;
  // `painSeverity` is nullable; treat `null` as 0 so a chestPain=true
  // log with no severity is conservatively classified as warn, never as
  // a missed bypass.
  const severity = input.painSeverity ?? 0;

  // ── Critical-bypass band (hardcoded, CLAUDE.md "Phase 4 Invariants") ──
  if (hr < HR_CRITICAL_LOW) {
    reasons.push("critical.hr_low");
  }
  if (hr > HR_CRITICAL_HIGH) {
    reasons.push("critical.hr_high");
  }
  if (input.chestPain && severity >= CHEST_PAIN_CRITICAL_SEVERITY) {
    reasons.push("critical.chest_pain_severe");
  }

  if (reasons.length > 0) {
    return { severity: "critical_bypass", reason: reasons[0]!, reasons };
  }

  // ── Warn band ──
  if (hr >= HR_WARN_LOW_INCLUSIVE && hr < HR_WARN_LOW_EXCLUSIVE_UPPER) {
    reasons.push("warn.hr_borderline_low");
  }
  if (hr >= HR_WARN_HIGH_INCLUSIVE && hr <= HR_WARN_HIGH_INCLUSIVE_UPPER) {
    reasons.push("warn.hr_borderline_high");
  }
  if (input.chestPain) {
    // Reached here only when severity < CHEST_PAIN_CRITICAL_SEVERITY
    // (the critical branch above ate the ≥ case). Any chest-pain report
    // is at minimum a warn.
    reasons.push("warn.chest_pain");
  }
  if (input.rhythmStatus === "irregular") {
    reasons.push("warn.rhythm_irregular");
  }
  if (input.exerciseTolerance === "reduced" || input.exerciseTolerance === "severe") {
    reasons.push("warn.exercise_intolerance");
  }

  if (reasons.length > 0) {
    return { severity: "warn", reason: reasons[0]!, reasons };
  }

  return { severity: "normal", reason: "normal", reasons: [] };
};

/**
 * True when this reading should enqueue the existing CRITICAL_ALERT
 * chain (push + SMS + fullscreen + call), per CLAUDE.md "Multi-condition
 * Critical-Bypass Dispatch". Exported as a separate helper so the
 * service layer can branch on it without re-reading `severity`.
 */
export const shouldTriggerCardiacBypass = (input: CardiacClassificationInput): boolean =>
  classifyCardiacReading(input).severity === "critical_bypass";
