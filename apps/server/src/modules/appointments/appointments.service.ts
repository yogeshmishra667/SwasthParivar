// Phase 4 Feature G.2 — appointment CRUD service.
//
// Appointments are patient-owned and reference a patient-owned
// DoctorProfile. Authz is the same household model as doctors /
// emergency-contacts: cross-user access via `resolveHouseholdMember`,
// per-row re-resolution so an outsider can't touch a row by id.
//
// Reminder-flag reset on reschedule: the hourly APPOINTMENT_REMINDER
// cron (chunk 3) uses `reminderSent7d/1d/2h` to fire each window once.
// When the visit is moved, those flags reset to false so the new date
// re-arms all three. Without this, moving an appointment forward a week
// would silently suppress the 7d/1d/2h reminders.

import { DomainError } from "@swasth/shared-types";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import type { AuthClaims } from "../../shared/middleware/auth.js";
import { assertDoctorPortalEnabled, resolveOwnedDoctor } from "../doctors/doctors.service.js";
import type { AppointmentStatusDto, DoctorAppointmentDto } from "./appointments.types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toDto = (row: {
  id: string;
  userId: string;
  doctorId: string;
  scheduledAt: Date;
  purpose: string;
  status: AppointmentStatusDto;
  preVisitReportId: string | null;
  createdAt: Date;
}): DoctorAppointmentDto => ({
  id: row.id,
  userId: row.userId,
  doctorId: row.doctorId,
  scheduledAt: row.scheduledAt.toISOString(),
  purpose: row.purpose,
  status: row.status,
  preVisitReportId: row.preVisitReportId,
  createdAt: row.createdAt.toISOString(),
});

export const createAppointment = async (
  auth: AuthClaims,
  params: {
    doctorId: string;
    scheduledAt: Date;
    purpose: string;
    targetUserId?: string;
  },
): Promise<DoctorAppointmentDto> => {
  await assertDoctorPortalEnabled(auth);
  const userId = await resolveHouseholdMember(auth, params.targetUserId);

  // The referenced doctor must exist AND be owned by the same household.
  // Resolving it also blocks pointing an appointment at another
  // household's doctor row.
  const doctor = await resolveOwnedDoctor(auth, params.doctorId);
  // The appointment's patient and the doctor's owner must be the same
  // user — you can't book patient A's visit against patient B's doctor,
  // even within one household.
  if (doctor.ownerUserId !== userId) {
    throw new DomainError("DOCTOR_NOT_FOUND", "doctor not found for this patient");
  }

  const created = await prisma.doctorAppointment.create({
    data: {
      userId,
      doctorId: params.doctorId,
      scheduledAt: params.scheduledAt,
      purpose: params.purpose,
    },
  });

  captureAnalyticsEvent("appointment_created", userId, {
    appointment_id: created.id,
    doctor_id: created.doctorId,
    days_until: Math.floor((created.scheduledAt.getTime() - Date.now()) / MS_PER_DAY),
  });

  return toDto(created);
};

export const listAppointments = async (
  auth: AuthClaims,
  params: {
    from?: Date;
    to?: Date;
    status?: AppointmentStatusDto;
    targetUserId?: string;
    limit: number;
    cursor?: string;
  },
): Promise<{ data: DoctorAppointmentDto[]; cursor: string | null; hasMore: boolean }> => {
  await assertDoctorPortalEnabled(auth);
  const userId = await resolveHouseholdMember(auth, params.targetUserId);

  const where: Prisma.DoctorAppointmentWhereInput = {
    userId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.from || params.to
      ? {
          scheduledAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
  };

  // Upcoming-first. Cursor is the plain row id (PK is a single uuid, so
  // no composite cursor needed). `id` tiebreak keeps ordering stable
  // when two appointments share a `scheduledAt`.
  const rows = await prisma.doctorAppointment.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: params.limit + 1,
    ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? last.id : null;
  return { data: data.map(toDto), cursor, hasMore };
};

// Re-resolves an appointment the caller owns, or throws
// APPOINTMENT_NOT_FOUND. Used by update + complete.
const resolveOwnedAppointment = async (
  auth: AuthClaims,
  appointmentId: string,
): Promise<{ id: string; userId: string; scheduledAt: Date }> => {
  const existing = await prisma.doctorAppointment.findUnique({ where: { id: appointmentId } });
  if (!existing) {
    throw new DomainError("APPOINTMENT_NOT_FOUND", "appointment not found");
  }
  await resolveHouseholdMember(auth, existing.userId);
  return existing;
};

export const updateAppointment = async (
  auth: AuthClaims,
  params: {
    appointmentId: string;
    scheduledAt?: Date;
    purpose?: string;
    status?: AppointmentStatusDto;
  },
): Promise<DoctorAppointmentDto> => {
  await assertDoctorPortalEnabled(auth);
  const existing = await resolveOwnedAppointment(auth, params.appointmentId);

  // Reschedule → re-arm all three reminder windows. We compare on epoch
  // millis so an identical re-submit doesn't needlessly reset flags.
  const isReschedule =
    params.scheduledAt !== undefined &&
    params.scheduledAt.getTime() !== existing.scheduledAt.getTime();

  const updated = await prisma.doctorAppointment.update({
    where: { id: params.appointmentId },
    data: {
      ...(params.scheduledAt !== undefined ? { scheduledAt: params.scheduledAt } : {}),
      ...(params.purpose !== undefined ? { purpose: params.purpose } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(isReschedule
        ? { reminderSent7d: false, reminderSent1d: false, reminderSent2h: false }
        : {}),
    },
  });
  return toDto(updated);
};

export const completeAppointment = async (
  auth: AuthClaims,
  appointmentId: string,
): Promise<DoctorAppointmentDto> => {
  await assertDoctorPortalEnabled(auth);
  await resolveOwnedAppointment(auth, appointmentId);
  const updated = await prisma.doctorAppointment.update({
    where: { id: appointmentId },
    data: { status: "completed" },
  });
  return toDto(updated);
};
