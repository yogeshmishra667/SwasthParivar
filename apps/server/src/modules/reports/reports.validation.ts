// Phase 4 Feature G.4 — report generation validation.

import { z } from "zod";

export const generateReportSchema = z.object({
  // Optional — a report can be generated stand-alone or tied to a booked
  // visit. When present it's recorded on the Report row and rendered.
  appointmentId: z.string().uuid().optional(),
  // Household primary generating on a sub-profile's behalf (same pattern
  // as doctors / appointments).
  targetUserId: z.string().uuid().optional(),
});
