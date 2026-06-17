import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import { activityCreateSchema, listActivityQuerySchema } from "./activity.validation.js";
import * as controller from "./activity.controller.js";

export const activityRouter: Router = Router();

activityRouter.use(requireAuth);

// POST /api/v1/activity/daily | GET /api/v1/activity?from=&to= (phase4.md §I.1)
activityRouter.post("/daily", validateBody(activityCreateSchema), controller.postActivity);
activityRouter.get("/", validateQuery(listActivityQuerySchema), controller.getActivity);
