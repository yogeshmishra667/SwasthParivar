export interface BPClassificationInput {
  /** mmHg. */
  systolic: number;
  /** mmHg. */
  diastolic: number;
}

/**
 * Stable identifiers for the reasons the classifier can return. The
 * mobile / server layers map these to i18n copy; never use them as
 * user-visible text.
 */
export type BPClassificationReason =
  | "critical.sys_high"
  | "critical.dia_high"
  | "critical.sys_low"
  | "critical.dia_low"
  | "normal";

export type BPSeverity = "normal" | "critical_bypass";

export interface BPClassification {
  severity: BPSeverity;
  /** First reason — high before low, systolic before diastolic. */
  reason: BPClassificationReason;
  /** Every critical reason that matched; empty when normal. */
  reasons: BPClassificationReason[];
}
