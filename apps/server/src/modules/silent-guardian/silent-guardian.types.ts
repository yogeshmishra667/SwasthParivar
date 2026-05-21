// Phase 3 Feature C — Silent Guardian module service I/O types.
//
// This slice (C-2) ships the read/write endpoints over GuardianAlert
// rows. Signal compute (SILENT_GUARDIAN_ANALYZE) and dispatch land in
// later slices — nothing here produces a signal or sends a push.

import type { GuardianAlert, GuardianAlertType } from "@prisma/client";

// Guardian actions captured on alert feedback. Free-form on the column
// (a new action needs no migration); validated to this set at the edge.
export type AlertActionTaken = "called_patient" | "ignored" | "helpful";

export interface ListAlertsParams {
  guardianId: string;
  patientId?: string | undefined;
  type?: GuardianAlertType | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface MarkAlertReadParams {
  guardianId: string;
  alertId: string;
}

export interface RecordFeedbackParams {
  guardianId: string;
  alertId: string;
  helpful: boolean;
  actionTaken?: AlertActionTaken | undefined;
}

export interface DailySummaryParams {
  guardianId: string;
  patientId: string;
}

export interface DailySummaryView {
  patient: { id: string; name: string };
  // Yellow-severity alerts from the last 24h. Yellow alerts never push
  // (CLAUDE.md Alert Fatigue: "Yellow summary only"); the daily summary
  // is their only delivery surface.
  yellowAlerts: GuardianAlert[];
  generatedAt: string;
}
