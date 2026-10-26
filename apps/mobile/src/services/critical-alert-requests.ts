// Builds the fullscreen-alert request for a cardiac / respiratory log,
// from the shared classifiers, so it is raised synced or offline (audit P3).

import {
  classifyCardiacReading,
  classifyRespiratoryReading,
  type CardiacClassificationInput,
} from "@swasth/domain-logic";
import type { SymptomSeverity } from "@swasth/shared-types";

import { criticalReasonKey, type CriticalAlertRequest } from "@/stores/critical-alert.store";

/** null when the log is not critical. */
export const cardiacAlertRequest = (
  input: CardiacClassificationInput,
  userId: string | null,
  valueLabel: string,
): CriticalAlertRequest | null => {
  const c = classifyCardiacReading(input);
  if (c.severity !== "critical_bypass") return null;
  return {
    audience: "patient",
    userId,
    category: "cardiac",
    reasonKey: criticalReasonKey(c.reason),
    valueLabel,
  };
};

/**
 * null when the log is not critical locally. Without the personal-best
 * baseline (server-side) only severe symptoms classify here; a peak-flow
 * red zone is raised from the server's answer.
 */
export const respiratoryAlertRequest = (
  input: { peakFlow?: number; inhalerUsed: boolean; symptomSeverity: SymptomSeverity },
  userId: string | null,
  valueLabel: string | undefined,
): CriticalAlertRequest | null => {
  const c = classifyRespiratoryReading({
    peakFlow: input.peakFlow ?? null,
    baselinePeakFlow: null,
    inhalerUsed: input.inhalerUsed,
    symptomSeverity: input.symptomSeverity,
  });
  if (c.severity !== "critical_bypass") return null;
  return {
    audience: "patient",
    userId,
    category: "respiratory",
    reasonKey: criticalReasonKey(c.reason),
    ...(valueLabel !== undefined ? { valueLabel } : {}),
  };
};

/** The request for a log the server classified as critical (e.g. a peak-flow red zone). */
export const serverAlertRequest = (
  category: "cardiac" | "respiratory",
  primaryReason: string,
  userId: string | null,
  valueLabel: string | undefined,
): CriticalAlertRequest => ({
  audience: "patient",
  userId,
  category,
  reasonKey: criticalReasonKey(primaryReason),
  ...(valueLabel !== undefined ? { valueLabel } : {}),
});
