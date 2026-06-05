import { PEAK_FLOW_RED_ZONE_RATIO, PEAK_FLOW_YELLOW_ZONE_RATIO } from "@swasth/shared-types";
import type {
  RespiratoryClassification,
  RespiratoryClassificationInput,
  RespiratoryClassificationReason,
} from "./types.js";

/**
 * Pure classifier for a single respiratory reading.
 *
 * Decision precedence (first match wins for `severity`; all matches are
 * accumulated in `reasons`):
 *
 *   1. Critical-bypass (any one is enough):
 *      - peakFlow < baselinePeakFlow * {@link PEAK_FLOW_RED_ZONE_RATIO}
 *        (asthma red zone — CLAUDE.md "Phase 4 Invariants")
 *      - symptomSeverity === "severe"
 *   2. Warn band (any one):
 *      - peakFlow < baselinePeakFlow * {@link PEAK_FLOW_YELLOW_ZONE_RATIO}
 *        (asthma yellow zone, but above red)
 *      - symptomSeverity === "moderate"
 *      - symptomSeverity === "mild"
 *      - inhalerUsed (irrespective of symptom)
 *   3. Otherwise normal.
 *
 * When `peakFlow` or `baselinePeakFlow` is null, both peak-flow branches
 * are skipped — a log without numeric data falls back to symptom + inhaler
 * signal alone. This is intentional: critical-bypass on `symptomSeverity
 * === "severe"` still fires without a peak-flow number, which is the
 * common case during an acute attack when the patient cannot blow into
 * the meter.
 *
 * Pure — no I/O, no `Date.now()`. Deterministic.
 */
export const classifyRespiratoryReading = (
  input: RespiratoryClassificationInput,
): RespiratoryClassification => {
  const reasons: RespiratoryClassificationReason[] = [];

  const hasPeakFlowData = input.peakFlow !== null && input.baselinePeakFlow !== null;
  // Guard against a baseline of 0 — division would yield Infinity and
  // every reading would be classified as "above red zone" incorrectly.
  // baselinePeakFlow=0 is also a clinical impossibility, so treat it as
  // "no baseline" rather than as a divisor.
  const baselineUsable = hasPeakFlowData && input.baselinePeakFlow! > 0;
  const peakFlowRatio = baselineUsable ? input.peakFlow! / input.baselinePeakFlow! : null;

  // ── Critical-bypass band (hardcoded, CLAUDE.md "Phase 4 Invariants") ──
  if (peakFlowRatio !== null && peakFlowRatio < PEAK_FLOW_RED_ZONE_RATIO) {
    reasons.push("critical.peak_flow_red_zone");
  }
  if (input.symptomSeverity === "severe") {
    reasons.push("critical.symptom_severe");
  }

  if (reasons.length > 0) {
    return {
      severity: "critical_bypass",
      reason: reasons[0]!,
      reasons,
      peakFlowRatio,
    };
  }

  // ── Warn band ──
  if (
    peakFlowRatio !== null &&
    peakFlowRatio >= PEAK_FLOW_RED_ZONE_RATIO &&
    peakFlowRatio < PEAK_FLOW_YELLOW_ZONE_RATIO
  ) {
    reasons.push("warn.peak_flow_yellow_zone");
  }
  if (input.symptomSeverity === "moderate") {
    reasons.push("warn.symptom_moderate");
  } else if (input.symptomSeverity === "mild") {
    reasons.push("warn.symptom_mild");
  }
  if (input.inhalerUsed) {
    reasons.push("warn.inhaler_used");
  }

  if (reasons.length > 0) {
    return { severity: "warn", reason: reasons[0]!, reasons, peakFlowRatio };
  }

  return { severity: "normal", reason: "normal", reasons: [], peakFlowRatio };
};

/**
 * True when this reading should enqueue the existing CRITICAL_ALERT
 * chain. Service-layer convenience: equivalent to checking severity.
 */
export const shouldTriggerRespiratoryBypass = (input: RespiratoryClassificationInput): boolean =>
  classifyRespiratoryReading(input).severity === "critical_bypass";
