// Wire types for the doctor-portal surface (Phase 4 Feature G).
//
// Kept here (not in shared-types) until the mobile app consumes it — at
// which point this moves to packages/shared-types/. Same staging the
// emergency-contacts module used.

export interface DoctorProfileDto {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  clinicName: string | null;
  phone: string | null;
  createdAt: string;
}
