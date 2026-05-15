import { Router } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import { validateQuery } from "../../shared/validate.js";
import * as controller from "./health-score.controller.js";
import { healthScoreQuerySchema } from "./health-score.validation.js";

export const healthScoreRouter: Router = Router();

healthScoreRouter.use(requireAuth);

// GET /api/v1/health-score — most-recent stored daily score, or
// on-the-fly compute for cold-start users. Cache 24h, invalidated by
// the daily worker.
healthScoreRouter.get("/", validateQuery(healthScoreQuerySchema), controller.getCurrent);
