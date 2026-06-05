import type { SymptomSeverity } from "@swasth/shared-types";

export interface RespiratoryClassificationInput {
  /**
   * Peak expiratory flow in L/min from this reading. Nullable for
   * inhaler-use-only or symptom-only logs.
   */
  peakFlow: number | null;
  /**
   * Patient's personal-best peak flow, snapshotted onto the log at
   * write time. Nullable for users who haven't established a baseline;
   * when null the peak-flow zone branches are skipped and the classifier
   * relies on symptomSeverity + inhalerUsed alone.
   */
  baselinePeakFlow: number | null;
  inhalerUsed: boolean;
  symptomSeverity: SymptomSeverity;
}

/**
 * Stable identifiers for the precedence-ordered set of reasons the
 * classifier can return. Mapped to i18n copy by the UI/server layers.
 */
export type RespiratoryClassificationReason =
  | "critical.peak_flow_red_zone"
  | "critical.symptom_severe"
  | "warn.peak_flow_yellow_zone"
  | "warn.symptom_moderate"
  | "warn.symptom_mild"
  | "warn.inhaler_used"
  | "normal";

export type RespiratorySeverity = "normal" | "warn" | "critical_bypass";

export interface RespiratoryClassification {
  severity: RespiratorySeverity;
  reason: RespiratoryClassificationReason;
  reasons: readonly RespiratoryClassificationReason[];
  /**
   * Peak flow as a fraction of baseline. `null` when either input is
   * null (no baseline established yet, or no peak-flow on this log).
   * Surfaced so the UI can render "62% of personal best" without
   * recomputing.
   */
  peakFlowRatio: number | null;
}
