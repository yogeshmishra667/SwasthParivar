// Wire types for the pre-visit reports surface (Phase 4 Feature G.4).

export type ReportStatusDto = "generating" | "ready" | "failed";

export interface ReportDto {
  id: string;
  status: ReportStatusDto;
  appointmentId: string | null;
  aiSummaryIncluded: boolean;
  createdAt: string;
}

export interface GenerateReportJob {
  reportId: string;
}
