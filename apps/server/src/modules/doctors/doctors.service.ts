// Phase 4 Feature G.2 — doctor-profile CRUD service.
//
// Patient-owned doctor rows. A patient or the household primary (on a
// sub-profile's behalf) can add / edit / list doctors. Doctor-side auth
// is OUT OF SCOPE for Phase 4 — nobody logs in "as a doctor"; these are
// address-book entries the patient keeps so appointments + prescriptions
// can reference them.
//
// Authz mirrors emergency-contacts / family: cross-user access goes
// through `resolveHouseholdMember`, which throws FAMILY_NO_ACCESS on a
// cross-household `targetUserId`. Per-row reads/writes re-resolve the
// owning user so an outsider can never touch a row by guessing its id.

import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { isFeatureEnabled } from "../../shared/rollout.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import type { AuthClaims } from "../../shared/middleware/auth.js";
import type { DoctorProfileDto } from "./doctors.types.js";

// Kill-switch shared by the doctors, appointments, and (chunk 4) reports
// surfaces. Default OFF per phase4.md "Phase 4 kill-switch flags".
// Exported so the appointments service gates on the same flag without
// duplicating the copy.
// Resolved per account (the JWT subject), as `GET /config/features` does
// (audit D3), so a cohort enables it for that account only.
export const assertDoctorPortalEnabled = async (auth: AuthClaims): Promise<void> => {
  const enabled = await isFeatureEnabled("doctor_portal_enabled", auth.sub);
  if (!enabled) {
    throw new DomainError(
      "DOCTOR_PORTAL_DISABLED",
      "Doctor portal is currently unavailable. Try again later.",
    );
  }
};

const toDto = (row: {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  clinicName: string | null;
  phone: string | null;
  createdAt: Date;
}): DoctorProfileDto => ({
  id: row.id,
  userId: row.userId,
  name: row.name,
  specialty: row.specialty,
  clinicName: row.clinicName,
  phone: row.phone,
  createdAt: row.createdAt.toISOString(),
});

export const listDoctors = async (
  auth: AuthClaims,
  targetUserId: string | undefined,
): Promise<DoctorProfileDto[]> => {
  await assertDoctorPortalEnabled(auth);
  const userId = await resolveHouseholdMember(auth, targetUserId);
  const rows = await prisma.doctorProfile.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(toDto);
};

export const createDoctor = async (
  auth: AuthClaims,
  params: {
    name: string;
    specialty: string;
    clinicName?: string;
    phone?: string;
    targetUserId?: string;
  },
): Promise<DoctorProfileDto> => {
  await assertDoctorPortalEnabled(auth);
  const userId = await resolveHouseholdMember(auth, params.targetUserId);
  const created = await prisma.doctorProfile.create({
    data: {
      userId,
      name: params.name,
      specialty: params.specialty,
      clinicName: params.clinicName ?? null,
      phone: params.phone ?? null,
    },
  });
  return toDto(created);
};

export const updateDoctor = async (
  auth: AuthClaims,
  params: {
    doctorId: string;
    name?: string;
    specialty?: string;
    clinicName?: string | null;
    phone?: string | null;
  },
): Promise<DoctorProfileDto> => {
  await assertDoctorPortalEnabled(auth);
  const existing = await prisma.doctorProfile.findUnique({ where: { id: params.doctorId } });
  if (!existing) {
    throw new DomainError("DOCTOR_NOT_FOUND", "doctor not found");
  }
  // Re-resolve the owning user: throws FAMILY_NO_ACCESS on a cross-
  // household attempt (same as emergency-contacts per-row authz).
  await resolveHouseholdMember(auth, existing.userId);

  const updated = await prisma.doctorProfile.update({
    where: { id: params.doctorId },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.specialty !== undefined ? { specialty: params.specialty } : {}),
      ...(params.clinicName !== undefined ? { clinicName: params.clinicName } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
    },
  });
  return toDto(updated);
};

// Shared by the appointments service: resolves a doctor the caller is
// allowed to reference, or throws DOCTOR_NOT_FOUND. Keeps the FK-validity
// + household-authz check in one place. Returns the owning userId so the
// caller can assert the appointment's patient matches the doctor's owner.
export const resolveOwnedDoctor = async (
  auth: AuthClaims,
  doctorId: string,
): Promise<{ doctorId: string; ownerUserId: string }> => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) {
    throw new DomainError("DOCTOR_NOT_FOUND", "doctor not found");
  }
  await resolveHouseholdMember(auth, doctor.userId);
  return { doctorId: doctor.id, ownerUserId: doctor.userId };
};
