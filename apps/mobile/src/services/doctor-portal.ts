// Phase 4 §G mobile — client for the doctor portal:
// /api/v1/doctors, /api/v1/appointments, /api/v1/reports.
//
// Mirrors the server DTOs 1:1. All endpoints are auth-protected and the
// server enforces household-scoped authz via `resolveHouseholdMember`
// using `targetUserId` — so, exactly like emergency-contacts.ts, the
// screens pass the active profile's id when the household primary is
// operating a sub-profile.
//
// Writes throw on failure (the screen surfaces a Hindi-first error);
// reads throw too — the calling screen owns the cached/fallback UI.

import { api, client } from "@/services/api";

export interface DoctorProfileDto {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  clinicName: string | null;
  phone: string | null;
  createdAt: string;
}

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "missed";

export interface DoctorAppointmentDto {
  id: string;
  userId: string;
  doctorId: string;
  scheduledAt: string;
  purpose: string;
  status: AppointmentStatus;
  preVisitReportId: string | null;
  createdAt: string;
}

export type ReportStatus = "generating" | "ready" | "failed";

export interface ReportDto {
  id: string;
  status: ReportStatus;
  appointmentId: string | null;
  aiSummaryIncluded: boolean;
  createdAt: string;
}

interface DoctorsListResponse {
  success: boolean;
  data: { doctors: DoctorProfileDto[] };
}
interface DoctorResponse {
  success: boolean;
  data: { doctor: DoctorProfileDto };
}
interface AppointmentsListResponse {
  success: boolean;
  data: { data: DoctorAppointmentDto[]; cursor: string | null; hasMore: boolean };
}
interface AppointmentResponse {
  success: boolean;
  data: { appointment: DoctorAppointmentDto };
}
interface ReportResponse {
  success: boolean;
  data: { report: ReportDto };
}
interface ReportStatusResponse {
  success: boolean;
  data: { status: ReportStatus; ready: boolean };
}

// ── Doctors ──────────────────────────────────────────────────────────

export const listDoctors = async (targetUserId?: string): Promise<DoctorProfileDto[]> => {
  const params = targetUserId !== undefined ? { targetUserId } : undefined;
  const res = await api.get<DoctorsListResponse>("/doctors", { params });
  return res.data.doctors;
};

export interface CreateDoctorInput {
  name: string;
  specialty: string;
  clinicName?: string | undefined;
  phone?: string | undefined;
  targetUserId?: string | undefined;
}

export const createDoctor = async (input: CreateDoctorInput): Promise<DoctorProfileDto> => {
  const res = await api.post<DoctorResponse, CreateDoctorInput>("/doctors", input);
  return res.data.doctor;
};

// ── Appointments ─────────────────────────────────────────────────────

export const listAppointments = async (params?: {
  status?: AppointmentStatus;
  targetUserId?: string;
}): Promise<DoctorAppointmentDto[]> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.targetUserId) query.targetUserId = params.targetUserId;
  const res = await api.get<AppointmentsListResponse>("/appointments", {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return res.data.data;
};

export const getAppointment = async (
  id: string,
  targetUserId?: string,
): Promise<DoctorAppointmentDto | null> => {
  // No dedicated GET-one route; the list is small per patient, so we
  // filter client-side. Returns null when not found.
  const all = await listAppointments(targetUserId !== undefined ? { targetUserId } : undefined);
  return all.find((a) => a.id === id) ?? null;
};

export interface CreateAppointmentInput {
  doctorId: string;
  /** ISO-8601. */
  scheduledAt: string;
  purpose: string;
  targetUserId?: string | undefined;
}

export const createAppointment = async (
  input: CreateAppointmentInput,
): Promise<DoctorAppointmentDto> => {
  const res = await api.post<AppointmentResponse, CreateAppointmentInput>("/appointments", input);
  return res.data.appointment;
};

export const completeAppointment = async (id: string): Promise<DoctorAppointmentDto> => {
  const res = await api.post<AppointmentResponse>(`/appointments/${id}/complete`);
  return res.data.appointment;
};

// ── Reports ──────────────────────────────────────────────────────────

export const generateReport = async (input: {
  appointmentId?: string | undefined;
  targetUserId?: string | undefined;
}): Promise<ReportDto> => {
  const res = await api.post<ReportResponse, typeof input>("/reports/generate", input);
  return res.data.report;
};

export const getReportStatus = async (
  reportId: string,
): Promise<{ status: ReportStatus; ready: boolean }> => {
  const res = await api.get<ReportStatusResponse>(`/reports/${reportId}/status`);
  return res.data;
};

/**
 * Resolves the signed PDF URL the client can open directly.
 *
 * `/reports/:id/download` 302-redirects to a short-lived signed R2 URL.
 * On React Native the XHR layer auto-follows the redirect, and
 * `response.request.responseURL` exposes the FINAL resolved URL — i.e.
 * the signed R2 link, which needs no auth header. We open THAT with
 * Linking (the API call carried the bearer; the signed link does not
 * need one). The PDF body is fetched-then-discarded — a few tens of KB.
 */
export const resolveReportDownloadUrl = async (reportId: string): Promise<string> => {
  const res = await client.get(`/reports/${reportId}/download`, {
    responseType: "arraybuffer",
  });
  const finalUrl = (res.request as { responseURL?: string } | undefined)?.responseURL;
  if (!finalUrl) {
    throw new Error("could not resolve report download url");
  }
  return finalUrl;
};
