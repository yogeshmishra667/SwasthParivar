import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/validate.js";
import { updatePreferencesSchema, updateProfileSchema } from "./users.validation.js";
import * as controller from "./users.controller.js";

export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

usersRouter.get("/me", controller.getMe);
usersRouter.patch("/me", validateBody(updateProfileSchema), controller.patchMe);
usersRouter.get("/me/preferences", controller.getPreferences);
usersRouter.put(
  "/me/preferences",
  validateBody(updatePreferencesSchema),
  controller.updatePreferences,
);
