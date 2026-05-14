export const MEDICATION_LOG_STATUSES = [
  "taken",
  "skipped",
  "missed_no_response",
  "delayed",
] as const;

export type MedicationLogStatus = (typeof MEDICATION_LOG_STATUSES)[number];
