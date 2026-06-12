// Wire types for the appointments surface (Phase 4 Feature G).

export type AppointmentStatusDto = "scheduled" | "completed" | "cancelled" | "missed";

export interface DoctorAppointmentDto {
  id: string;
  userId: string;
  doctorId: string;
  scheduledAt: string;
  purpose: string;
  status: AppointmentStatusDto;
  preVisitReportId: string | null;
  createdAt: string;
}
