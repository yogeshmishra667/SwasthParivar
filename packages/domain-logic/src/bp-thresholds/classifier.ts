import {
  BP_CRITICAL_DIASTOLIC_HIGH,
  BP_CRITICAL_DIASTOLIC_LOW,
  BP_CRITICAL_SYSTOLIC_HIGH,
  BP_CRITICAL_SYSTOLIC_LOW,
} from "@swasth/shared-types";
import type { BPClassification, BPClassificationInput, BPClassificationReason } from "./types.js";

/**
 * Pure classifier for a single BP reading against the HARDCODED
 * critical-bypass thresholds (CLAUDE.md "Phase 4 Invariants"):
 *
 *   - low:  systolic < 90  OR diastolic < 60
 *   - high: systolic > 180 OR diastolic > 110
 *
 * All matches accumulate in `reasons`, high before low, so a reading that
 * is both (190/55) leads with the hypertensive-crisis reason. There is no
 * warn band here — BP trend and spike insights are the detectors' job.
 *
 * Pure — no I/O, no `Date.now()`. Safe in the HTTP path, the worker and
 * the mobile pre-save preview.
 */
export const classifyBPReading = (input: BPClassificationInput): BPClassification => {
  const reasons: BPClassificationReason[] = [];
  if (input.systolic > BP_CRITICAL_SYSTOLIC_HIGH) reasons.push("critical.sys_high");
  if (input.diastolic > BP_CRITICAL_DIASTOLIC_HIGH) reasons.push("critical.dia_high");
  if (input.systolic < BP_CRITICAL_SYSTOLIC_LOW) reasons.push("critical.sys_low");
  if (input.diastolic < BP_CRITICAL_DIASTOLIC_LOW) reasons.push("critical.dia_low");

  if (reasons.length > 0) {
    return { severity: "critical_bypass", reason: reasons[0]!, reasons };
  }
  return { severity: "normal", reason: "normal", reasons: [] };
};

/** True when this reading should enqueue the CRITICAL_ALERT chain. */
export const shouldTriggerBPBypass = (input: BPClassificationInput): boolean =>
  classifyBPReading(input).severity === "critical_bypass";
