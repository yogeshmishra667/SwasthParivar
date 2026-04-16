import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/validate.js";
import { createScheduleSchema, logMedicationSchema } from "./medications.validation.js";
import * as controller from "./medications.controller.js";

export const medicationsRouter: Router = Router();

medicationsRouter.use(requireAuth);

medicationsRouter.get("/schedule", controller.getSchedules);
medicationsRouter.post("/schedule", validateBody(createScheduleSchema), controller.postSchedule);
medicationsRouter.post("/log", validateBody(logMedicationSchema), controller.postLog);
medicationsRouter.get("/adherence", controller.getAdherence);
