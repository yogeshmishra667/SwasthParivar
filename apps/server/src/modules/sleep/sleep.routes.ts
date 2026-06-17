import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import { sleepCreateSchema, listSleepQuerySchema } from "./sleep.validation.js";
import * as controller from "./sleep.controller.js";

export const sleepRouter: Router = Router();

sleepRouter.use(requireAuth);

// POST /api/v1/sleep | GET /api/v1/sleep?from=&to= (phase4.md §I.1)
sleepRouter.post("/", validateBody(sleepCreateSchema), controller.postSleep);
sleepRouter.get("/", validateQuery(listSleepQuerySchema), controller.getSleep);
