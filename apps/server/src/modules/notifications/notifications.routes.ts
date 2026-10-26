/**
 * Routes mounted under /api/v1/notifications. Auth required.
 *
 *   POST /opened   the app reports a tapped push (audit P11)
 */

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/validate.js";
import { notificationOpenedSchema } from "./notifications.validation.js";
import * as controller from "./notifications.controller.js";

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.post("/opened", validateBody(notificationOpenedSchema), controller.postOpened);
