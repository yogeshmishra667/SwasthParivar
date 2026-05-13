import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  acknowledgeInsightSchema,
  listInsightsQuerySchema,
} from "./insights.validation.js";
import * as controller from "./insights.controller.js";

export const insightsRouter: Router = Router();

insightsRouter.use(requireAuth);

insightsRouter.get("/", validateQuery(listInsightsQuerySchema), controller.getInsights);
insightsRouter.post(
  "/:id/acknowledge",
  validateBody(acknowledgeInsightSchema),
  controller.postAcknowledge,
);
