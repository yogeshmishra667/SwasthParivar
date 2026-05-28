// Phase 4 Feature D' — /api/v1/sos router.
//
// Endpoint map (CLAUDE.md "SOS"):
//   POST /trigger       patient presses SOS
//   POST /:id/cancel    patient/guardian aborts the chain
//   POST /:id/resolve   patient/guardian/admin marks resolved
//   GET  /active        most-recent non-terminal SOS for re-render
//
// `sos_enabled` (Redis flag, default false) is enforced inside the
// service so it kills writes AND the worker tick.

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateParams } from "../../shared/validate.js";
import {
  sosCancelSchema,
  sosIdParamSchema,
  sosResolveSchema,
  sosTriggerSchema,
} from "./sos.validation.js";
import * as controller from "./sos.controller.js";

export const sosRouter: Router = Router();

sosRouter.use(requireAuth);

sosRouter.post("/trigger", validateBody(sosTriggerSchema), controller.postTrigger);

sosRouter.post(
  "/:id/cancel",
  validateParams(sosIdParamSchema),
  validateBody(sosCancelSchema),
  controller.postCancel,
);

sosRouter.post(
  "/:id/resolve",
  validateParams(sosIdParamSchema),
  validateBody(sosResolveSchema),
  controller.postResolve,
);

sosRouter.get("/active", controller.getActive);
