// Phase 4 Feature G.4 — /api/v1/reports router.
//
// Endpoint map:
//   POST /generate          enqueue a pre-visit PDF → 202 {report}
//   GET  /:reportId/status  poll generation status
//   GET  /:reportId/download  302 → signed R2 URL (1-hour expiry)
//
// All require `requireAuth`; `doctor_portal_enabled` is enforced in the
// service layer (503 DOCTOR_PORTAL_DISABLED when off).

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/validate.js";
import { generateReportSchema } from "./reports.validation.js";
import * as controller from "./reports.controller.js";

export const reportsRouter: Router = Router();

reportsRouter.use(requireAuth);

reportsRouter.post("/generate", validateBody(generateReportSchema), controller.postGenerate);
reportsRouter.get("/:reportId/status", controller.getStatus);
reportsRouter.get("/:reportId/download", controller.getDownload);
