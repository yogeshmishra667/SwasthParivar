// Phase 4 Feature G.2 — appointment CRUD validation.
//
// An appointment links a patient to one of their DoctorProfile rows at a
// scheduled time. `targetUserId` mirrors the family / doctors pattern.
// `scheduledAt` is an ISO-8601 datetime; back-dating is allowed (logging
// a completed past visit) — the reminder cron simply finds no future
// window to fire.

import { z } from "zod";

const appointmentStatusSchema = z.enum(["scheduled", "completed", "cancelled", "missed"]);

export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  purpose: z.string().min(1).max(200),
  targetUserId: z.string().uuid().optional(),
});

export const updateAppointmentSchema = z
  .object({
    scheduledAt: z.coerce.date().optional(),
    purpose: z.string().min(1).max(200).optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine(
    (v) => v.scheduledAt !== undefined || v.purpose !== undefined || v.status !== undefined,
    "at least one field is required",
  );

export const listAppointmentsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: appointmentStatusSchema.optional(),
  targetUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
