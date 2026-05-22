import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import {
  cohortPatchSchema,
  evaluateQuerySchema,
  flagKeyParamSchema,
  setFlagSchema,
} from "./admin-flags.validation.js";
import * as controller from "./admin-flags.controller.js";

// Mounted at /admin/flags behind requireAdminAuth (see admin.routes.ts).
// Reads + the rollout preview are open to every authenticated role;
// writes (set / rollback / cohort) and the audit trail are super_admin
// + ops only — see the RBAC table in docs/admin-dashboard-plan.md.
export const adminFlagsRouter: Router = Router();

const writers = requireAdminRole("super_admin", "ops");

adminFlagsRouter.get("/", controller.list);

adminFlagsRouter.get("/:key", validateParams(flagKeyParamSchema), controller.getOne);

adminFlagsRouter.get("/:key/audit", writers, validateParams(flagKeyParamSchema), controller.audit);

adminFlagsRouter.get(
  "/:key/evaluate",
  validateParams(flagKeyParamSchema),
  validateQuery(evaluateQuerySchema),
  controller.evaluate,
);

adminFlagsRouter.put(
  "/:key",
  writers,
  validateParams(flagKeyParamSchema),
  validateBody(setFlagSchema),
  controller.set,
);

adminFlagsRouter.post(
  "/:key/rollback",
  writers,
  validateParams(flagKeyParamSchema),
  controller.rollback,
);

adminFlagsRouter.patch(
  "/:key/cohort",
  writers,
  validateParams(flagKeyParamSchema),
  validateBody(cohortPatchSchema),
  controller.patchCohort,
);
