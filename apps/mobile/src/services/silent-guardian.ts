// Phase 3 Feature C — Silent Guardian client. Wraps the /guardian
// endpoints (server module silent-guardian).
//
// Reads fail soft (empty page / null) so a guardian's alert list never
// crashes the screen — the same pattern as insights.ts / family.ts.

import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export type GuardianAlertSeverity = "yellow" | "orange";
export type GuardianAlertType = "trend_concern" | "med_adherence" | "combined";

export interface GuardianAlertDto {
  id: string;
  patientId: string;
  guardianId: string;
  alertType: GuardianAlertType;
  riskScore: number;
  severity: GuardianAlertSeverity;
  title: string;
  summary: string;
  explanation: string;
  suggestedAction: string;
  details: Record<string, unknown>;
  signalIds: string[];
  sentVia: string[];
  pushDelivered: boolean;
  smsDelivered: boolean;
  readAt: string | null;
  actionTaken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianAlertPage {
  data: GuardianAlertDto[];
  cursor: string | null;
  hasMore: boolean;
}

export interface DailySummaryView {
  patient: { id: string; name: string };
  yellowAlerts: GuardianAlertDto[];
  generatedAt: string;
}

const EMPTY_PAGE: GuardianAlertPage = { data: [], cursor: null, hasMore: false };

export const listGuardianAlerts = async (params?: {
  patientId?: string;
  type?: GuardianAlertType;
  limit?: number;
  cursor?: string;
}): Promise<GuardianAlertPage> => {
  try {
    const res = await api.get<{ success: boolean; data: GuardianAlertPage }>("/guardian/alerts", {
      params,
    });
    return res.data;
  } catch (err) {
    logError("listGuardianAlerts", err);
    return EMPTY_PAGE;
  }
};

export const getGuardianDailySummary = async (
  patientId: string,
): Promise<DailySummaryView | null> => {
  try {
    const res = await api.get<{ success: boolean; data: DailySummaryView }>(
      `/guardian/daily-summary/${patientId}`,
    );
    return res.data;
  } catch (err) {
    logError("getGuardianDailySummary", err);
    return null;
  }
};

// Marking an alert read also returns the full alert, so the detail
// screen uses this as its single fetch — open = read.
export const markGuardianAlertRead = async (alertId: string): Promise<GuardianAlertDto | null> => {
  try {
    const res = await api.post<{ success: boolean; data: { alert: GuardianAlertDto } }>(
      `/guardian/alerts/${alertId}/read`,
    );
    return res.data.alert;
  } catch (err) {
    logError("markGuardianAlertRead", err);
    return null;
  }
};

export const sendGuardianAlertFeedback = async (
  alertId: string,
  feedback: { helpful: boolean; actionTaken?: "called_patient" | "ignored" | "helpful" },
): Promise<GuardianAlertDto | null> => {
  try {
    const res = await api.post<{ success: boolean; data: { alert: GuardianAlertDto } }>(
      `/guardian/alerts/${alertId}/feedback`,
      feedback,
    );
    return res.data.alert;
  } catch (err) {
    logError("sendGuardianAlertFeedback", err);
    return null;
  }
};
