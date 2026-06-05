import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import {
  glucoseCreateSchema,
  glucoseVoiceSchema,
  listReadingsQuerySchema,
} from "./readings.validation.js";
import { bpCreateSchema, listBPQuerySchema } from "./bp.validation.js";
import { cardiacCreateSchema, listCardiacQuerySchema } from "./cardiac.validation.js";
import { respiratoryCreateSchema, listRespiratoryQuerySchema } from "./respiratory.validation.js";
import * as controller from "./readings.controller.js";
import * as bpController from "./bp.controller.js";
import * as cardiacController from "./cardiac.controller.js";
import * as respiratoryController from "./respiratory.controller.js";

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

// Phase 4 Feature E — cardiac + respiratory log surfaces. Both gated
// by the cardiac_logging_enabled / respiratory_logging_enabled flags
// inside the service layer (default off). Routes mount unconditionally
// so a flag flip is a runtime change with no redeploy required.
readingsRouter.post("/cardiac", validateBody(cardiacCreateSchema), cardiacController.postCardiac);
readingsRouter.get("/cardiac", validateQuery(listCardiacQuerySchema), cardiacController.getCardiac);
readingsRouter.delete("/cardiac/:id", cardiacController.deleteCardiac);

readingsRouter.post(
  "/respiratory",
  validateBody(respiratoryCreateSchema),
  respiratoryController.postRespiratory,
);
readingsRouter.get(
  "/respiratory",
  validateQuery(listRespiratoryQuerySchema),
  respiratoryController.getRespiratory,
);
readingsRouter.delete("/respiratory/:id", respiratoryController.deleteRespiratory);
