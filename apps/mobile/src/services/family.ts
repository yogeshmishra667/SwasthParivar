// Phase 2 — family/guardian client. Mirrors the server module 1:1.
//
// All endpoints are auth-protected; the server resolves caller-vs-link
// roles, so the mobile UI just forwards intent (invite, respond,
// revoke, list). Read-only guardian dashboard reuses the same shape as
// the patient dashboard with PII stripped by the server.

import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export type FamilyLinkStatus = "pending" | "accepted" | "declined" | "revoked";
export type AlertSensitivity = "low" | "medium" | "high";

export interface FamilyLinkDto {
  id: string;
  patientId: string;
  guardianId: string;
  relationship: string | null;
  status: FamilyLinkStatus;
  alertEnabled: boolean;
  visibleConditions: string[];
  alertSensitivity: AlertSensitivity;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PatientLinkSummary {
  linkId: string;
  relationship: string | null;
  alertEnabled: boolean;
  alertSensitivity: AlertSensitivity;
  patient: { id: string; name: string };
  acceptedAt: string | null;
}

export interface InviteInput {
  guardianPhone: string;
  relationship?: string;
  visibleConditions: string[];
  alertEnabled: boolean;
  alertSensitivity: AlertSensitivity;
}

export type InviteResult =
  | { kind: "ok"; link: FamilyLinkDto; guardian: { id: string; name: string } }
  | { kind: "error"; code: string | null; message: string };

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

const errPayload = (err: unknown): { code: string | null; message: string } => {
  const e = err as { response?: { data?: ErrorResponse } } | undefined;
  return {
    code: e?.response?.data?.error?.code ?? null,
    message: e?.response?.data?.error?.message ?? "Request failed",
  };
};

export const inviteGuardian = async (input: InviteInput): Promise<InviteResult> => {
  try {
    const res = await api.post<{
      success: boolean;
      data: { link: FamilyLinkDto; guardian: { id: string; name: string } };
    }>("/family/invite", input);
    return { kind: "ok", link: res.data.link, guardian: res.data.guardian };
  } catch (err) {
    const { code, message } = errPayload(err);
    return { kind: "error", code, message };
  }
};

export const respondToInvite = async (
  linkId: string,
  decision: "accept" | "decline",
): Promise<FamilyLinkDto | null> => {
  try {
    const res = await api.post<{ success: boolean; data: { link: FamilyLinkDto } }>(
      `/family/invites/${linkId}/respond`,
      { decision },
    );
    return res.data.link;
  } catch (err) {
    logError("respondToInvite", err);
    return null;
  }
};

export const revokeLink = async (linkId: string): Promise<FamilyLinkDto | null> => {
  try {
    const res = await api.put<{ success: boolean; data: { link: FamilyLinkDto } }>(
      `/family/links/${linkId}/privacy`,
      { revoke: true },
    );
    return res.data.link;
  } catch (err) {
    logError("revokeLink", err);
    return null;
  }
};

export const listPatientsForGuardian = async (
  status: FamilyLinkStatus = "accepted",
): Promise<PatientLinkSummary[]> => {
  try {
    const res = await api.get<{ success: boolean; data: { patients: PatientLinkSummary[] } }>(
      "/family/patients",
      { params: { status } },
    );
    return res.data.patients;
  } catch (err) {
    logError("listPatientsForGuardian", err);
    return [];
  }
};

export interface PatientDashboardView {
  summary: {
    headline: string;
    details: readonly string[];
    language: "hi" | "en";
    coldStart: boolean;
  };
  streak: { currentStreakDays: number };
  latestReading: {
    valueMgDl: number;
    readingType: string;
    measuredAt: string;
  } | null;
  todayReadingCount: number;
  bpLatest: {
    systolic: number;
    diastolic: number;
    pulse: number | null;
    measuredAt: string;
  } | null;
  mealsToday: { id: string; mealType: string; mealCategory: string; loggedAt: string }[];
  insightsUnacknowledgedCount: number;
  healthScore: {
    score: number;
    components: {
      logging: number;
      stability: number;
      trend: number;
      medication: number;
      streak: number;
    };
    computedForDate: string;
  } | null;
}

export const getPatientDashboard = async (
  patientId: string,
): Promise<PatientDashboardView | null> => {
  try {
    const res = await api.get<{ success: boolean; data: PatientDashboardView }>(
      `/family/patients/${patientId}/dashboard`,
    );
    return res.data;
  } catch (err) {
    logError("getPatientDashboard", err);
    return null;
  }
};
