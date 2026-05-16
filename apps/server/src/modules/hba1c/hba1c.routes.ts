import { Router } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import { validateQuery } from "../../shared/validate.js";
import * as controller from "./hba1c.controller.js";
import { hba1cQuerySchema } from "./hba1c.validation.js";

export const hba1cRouter: Router = Router();

hba1cRouter.use(requireAuth);

// GET /api/v1/hba1c/estimate — recency-weighted 90-day glucose average
// converted to an HbA1c% estimate. Cache 1h. 422 INSUFFICIENT_DATA
// when fewer than 30 readings in the last 90 days (or no recent data).
hba1cRouter.get("/estimate", validateQuery(hba1cQuerySchema), controller.getEstimate);
