// Phase 3 Feature C — Silent Guardian request validation.
//
// Path params (:alertId, :patientId) are UUID-checked in the controller
// (same helper the family module uses); these schemas cover the query
// string and the feedback body.

import { z } from "zod";

// GET /guardian/alerts — list the calling guardian's alerts, optionally
// scoped to one patient and/or one alert type. Cursor is a GuardianAlert
// id (the list is keyed on id for stable pagination).
export const listAlertsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  type: z.enum(["trend_concern", "med_adherence", "combined"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

// POST /guardian/alerts/:alertId/feedback — `helpful` is the core
// yes/no feedback; `actionTaken` is the optional "what I did" follow-up.
export const alertFeedbackSchema = z.object({
  helpful: z.boolean(),
  actionTaken: z.enum(["called_patient", "ignored", "helpful"]).optional(),
});
