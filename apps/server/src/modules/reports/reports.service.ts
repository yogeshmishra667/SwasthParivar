// Phase 4 Feature G.4 — pre-visit reports service.
//
// `generate` creates a `Report` row in `generating` and enqueues the
// GENERATE_PDF job; the worker fills in the PDF. Status + download are
// read paths. Authz is the same household model as the rest of Feature G.
//
// Dedup: a second `generate` for the same (user, appointment) while one
// is still `generating` returns the in-flight row instead of spawning a
// duplicate render. Belt-and-suspenders with the BullMQ jobId.

import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { refreshObjectUrl } from "../../shared/storage/r2.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import type { AuthClaims } from "../../shared/middleware/auth.js";
import { assertDoctorPortalEnabled } from "../doctors/doctors.service.js";
import { enqueueGenerateReport } from "./reports.jobs.js";
import type { ReportDto } from "./reports.types.js";

const toDto = (row: {
  id: string;
  status: "generating" | "ready" | "failed";
  appointmentId: string | null;
  aiSummaryIncluded: boolean;
  createdAt: Date;
}): ReportDto => ({
  id: row.id,
  status: row.status,
  appointmentId: row.appointmentId,
  aiSummaryIncluded: row.aiSummaryIncluded,
  createdAt: row.createdAt.toISOString(),
});

export const generateReport = async (
  auth: AuthClaims,
  params: { appointmentId?: string; targetUserId?: string },
): Promise<ReportDto> => {
  await assertDoctorPortalEnabled();
  const userId = await resolveHouseholdMember(auth, params.targetUserId);

  // If an appointment was named, confirm it belongs to this patient —
  // 404 otherwise (don't leak another household's appointment).
  if (params.appointmentId) {
    const appt = await prisma.doctorAppointment.findUnique({
      where: { id: params.appointmentId },
      select: { userId: true },
    });
    if (appt?.userId !== userId) {
      throw new DomainError("APPOINTMENT_NOT_FOUND", "appointment not found");
    }
  }

  // Dedup: reuse an in-flight report for the same target (and appointment,
  // if any) rather than spawning a second render.
  const existing = await prisma.report.findFirst({
    where: {
      userId,
      status: "generating",
      appointmentId: params.appointmentId ?? null,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return toDto(existing);

  const report = await prisma.report.create({
    data: {
      userId,
      appointmentId: params.appointmentId ?? null,
      status: "generating",
    },
  });

  await enqueueGenerateReport({ reportId: report.id });
  captureAnalyticsEvent("report_requested", userId, {
    report_id: report.id,
    has_appointment: Boolean(params.appointmentId),
  });

  return toDto(report);
};

// Re-resolves a report the caller owns, or throws REPORT_NOT_FOUND.
const resolveOwnedReport = async (auth: AuthClaims, reportId: string) => {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new DomainError("REPORT_NOT_FOUND", "report not found");
  }
  await resolveHouseholdMember(auth, report.userId);
  return report;
};

export const getReportStatus = async (
  auth: AuthClaims,
  reportId: string,
): Promise<{ status: ReportDto["status"]; ready: boolean }> => {
  await assertDoctorPortalEnabled();
  const report = await resolveOwnedReport(auth, reportId);
  return { status: report.status, ready: report.status === "ready" };
};

// Returns a freshly-signed R2 URL (1-hour expiry). Throws
// REPORT_NOT_READY (409) before the PDF exists.
export const getReportDownloadUrl = async (auth: AuthClaims, reportId: string): Promise<string> => {
  await assertDoctorPortalEnabled();
  const report = await resolveOwnedReport(auth, reportId);
  if (report.status !== "ready" || !report.pdfR2Key) {
    throw new DomainError("REPORT_NOT_READY", "report is not ready yet");
  }
  return await refreshObjectUrl(report.pdfR2Key);
};
