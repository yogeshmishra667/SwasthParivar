// Phase 3 Feature C — /api/v1/guardian router.
//
// Endpoint map (CLAUDE.md "Silent Guardian"):
//   GET  /alerts?patientId=&type=        guardian's alerts (cursor-paged)
//   POST /alerts/:alertId/read           mark an alert read
//   POST /alerts/:alertId/feedback       helpful? + action taken
//   GET  /daily-summary/:patientId       yellow-severity alerts (no push)
//
// Closes the Phase 2 deferral of the family alerts endpoint. Signal
// compute + alert dispatch arrive in later slices.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import { alertFeedbackSchema, listAlertsQuerySchema } from "./silent-guardian.validation.js";
import * as controller from "./silent-guardian.controller.js";

export const silentGuardianRouter: Router = Router();

silentGuardianRouter.use(requireAuth);

silentGuardianRouter.get("/alerts", validateQuery(listAlertsQuerySchema), controller.getAlerts);

silentGuardianRouter.post("/alerts/:alertId/read", controller.postAlertRead);

silentGuardianRouter.post(
  "/alerts/:alertId/feedback",
  validateBody(alertFeedbackSchema),
  controller.postAlertFeedback,
);

silentGuardianRouter.get("/daily-summary/:patientId", controller.getDailySummary);
