// Phase 4 Feature G — doctor-profile CRUD validation.
//
// A DoctorProfile is patient-owned: created by the patient or the
// household primary on a sub-profile's behalf (no doctor-side auth in
// Phase 4). `targetUserId` mirrors the family / emergency-contacts
// pattern — when set, the service household-authorises it via
// `resolveHouseholdMember`.

import { z } from "zod";

// Same E.164 shape auth + emergency-contacts use. Optional here — many
// patients only know the clinic, not a direct doctor line.
const phoneSchema = z.string().regex(/^\+[1-9]\d{9,14}$/, "phone must be E.164 (e.g. +9198…)");

export const createDoctorSchema = z.object({
  name: z.string().min(1).max(80),
  specialty: z.string().min(1).max(60),
  clinicName: z.string().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
  targetUserId: z.string().uuid().optional(),
});

export const updateDoctorSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    specialty: z.string().min(1).max(60).optional(),
    // Nullable so the client can clear an optional field, not just omit it.
    clinicName: z.string().min(1).max(120).nullable().optional(),
    phone: phoneSchema.nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.specialty !== undefined ||
      v.clinicName !== undefined ||
      v.phone !== undefined,
    "at least one field is required",
  );

export const listDoctorsQuerySchema = z.object({
  targetUserId: z.string().uuid().optional(),
});
