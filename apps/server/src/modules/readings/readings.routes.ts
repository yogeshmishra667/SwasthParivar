import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  glucoseCreateSchema,
  glucoseVoiceSchema,
  listReadingsQuerySchema,
} from "./readings.validation.js";
import { bpCreateSchema, listBPQuerySchema } from "./bp.validation.js";
import * as controller from "./readings.controller.js";
import * as bpController from "./bp.controller.js";

export const readingsRouter: Router = Router();

readingsRouter.use(requireAuth);

readingsRouter.post("/glucose", validateBody(glucoseCreateSchema), controller.postGlucose);
readingsRouter.post(
  "/glucose/voice",
  validateBody(glucoseVoiceSchema),
  controller.postGlucoseVoice,
);
readingsRouter.get("/glucose", validateQuery(listReadingsQuerySchema), controller.getGlucose);
readingsRouter.delete("/glucose/:id", controller.deleteGlucose);

readingsRouter.post("/bp", validateBody(bpCreateSchema), bpController.postBP);
readingsRouter.get("/bp", validateQuery(listBPQuerySchema), bpController.getBP);
readingsRouter.delete("/bp/:id", bpController.deleteBP);
