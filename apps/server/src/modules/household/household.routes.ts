import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/validate.js";
import { addHouseholdProfileSchema } from "./household.validation.js";
import * as controller from "./household.controller.js";

export const householdRouter: Router = Router();

householdRouter.use(requireAuth);

householdRouter.post(
  "/profiles",
  validateBody(addHouseholdProfileSchema),
  controller.postAddProfile,
);
