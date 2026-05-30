import { Router } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery, validateParams } from "../../shared/validate.js";
import * as controller from "./schedules.controller.js";
import {
  createScheduleSchema,
  updateScheduleSchema,
  listSchedulesQuerySchema,
  scheduleParamsSchema,
} from "./schedules.validation.js";

export const schedulesRouter: Router = Router();

schedulesRouter.use(requireAuth);

// GET  /api/v1/schedules               → list user's schedules + compliance snapshot
// POST /api/v1/schedules               → create
// PUT  /api/v1/schedules/:id           → update (toggle active, edit slots/reminder)
schedulesRouter.get("/", validateQuery(listSchedulesQuerySchema), controller.getSchedules);
schedulesRouter.post("/", validateBody(createScheduleSchema), controller.postSchedule);
schedulesRouter.put(
  "/:id",
  validateParams(scheduleParamsSchema),
  validateBody(updateScheduleSchema),
  controller.putSchedule,
);
