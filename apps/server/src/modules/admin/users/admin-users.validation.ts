import { z } from "zod";

// Offset pagination — admin data grids want page jumps, not cursors.
const limit = z.coerce.number().int().min(1).max(100).default(25);
const offset = z.coerce.number().int().min(0).default(0);

export const listUsersQuerySchema = z.object({
  // Free-text search over name + phone.
  search: z.string().trim().max(120).optional(),
  limit,
  offset,
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

// `key` is checked against the registry in the service (unknown → 404),
// so the param schema only enforces a sane string shape here.
export const userResourceParamSchema = z.object({
  id: z.uuid(),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
});

export const resourcePageQuerySchema = z.object({
  limit,
  offset,
});

export const changeTierSchema = z.object({
  tier: z.enum(["free", "premium", "family"]),
});

// Phase 4 Week 13 admin carry-over — soft-disable a patient.
// `reason` is mandatory so the audit log always carries the WHY.
// Capped at 280 chars — operationally one-line justifications, not
// essays; longer notes live in the ops ticket tracker.
export const deactivateUserSchema = z.object({
  reason: z.string().trim().min(3).max(280),
});

// ── Ops appoint (Phase 4 §G admin surface) ──────────────────────────
// Ops creates a doctor and/or books an appointment on a patient's
// behalf (support flow). `reason` is mandatory on every write so the
// audit row always records the WHY (e.g. ticket ref). Phone uses the
// same E.164 shape the patient-facing surfaces enforce.
const e164 = z.string().regex(/^\+[1-9]\d{9,14}$/, "phone must be E.164 (e.g. +9198…)");

export const adminCreateDoctorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  specialty: z.string().trim().min(1).max(60),
  clinicName: z.string().trim().min(1).max(120).optional(),
  phone: e164.optional(),
  reason: z.string().trim().min(3).max(280),
});

export const adminCreateAppointmentSchema = z.object({
  doctorId: z.uuid(),
  scheduledAt: z.coerce.date(),
  purpose: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(280),
});
