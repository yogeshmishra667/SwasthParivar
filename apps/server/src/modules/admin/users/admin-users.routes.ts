import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import {
  changeTierSchema,
  deactivateUserSchema,
  listUsersQuerySchema,
  resourcePageQuerySchema,
  userIdParamSchema,
  userResourceParamSchema,
} from "./admin-users.validation.js";
import * as controller from "./admin-users.controller.js";

// Mounted at /admin/users behind requireAdminAuth (see admin.routes.ts).
// List + detail + non-sensitive panels are open to every authenticated
// role; sensitive panels are gated inside the service (support+), and
// tier changes require super_admin / ops.
export const adminUsersRouter: Router = Router();

adminUsersRouter.get("/", validateQuery(listUsersQuerySchema), controller.listUsers);

adminUsersRouter.get("/:id", validateParams(userIdParamSchema), controller.getUser);

adminUsersRouter.get(
  "/:id/resources/:key",
  validateParams(userResourceParamSchema),
  validateQuery(resourcePageQuerySchema),
  controller.getUserResource,
);

// Resolved feature-map viewer — what `GET /api/v1/config/features`
// returns for this user (per the plan's "App control surface").
adminUsersRouter.get(
  "/:id/feature-map",
  validateParams(userIdParamSchema),
  controller.getUserFeatureMap,
);

adminUsersRouter.patch(
  "/:id/tier",
  requireAdminRole("super_admin", "ops"),
  validateParams(userIdParamSchema),
  validateBody(changeTierSchema),
  controller.changeUserTier,
);

// Phase 4 Week 13 admin carry-over — soft-disable / restore a patient.
// super_admin + ops only (matches the tier-change boundary). Both
// endpoints idempotently coerce to the desired state and audit only
// on real transitions.
adminUsersRouter.post(
  "/:id/deactivate",
  requireAdminRole("super_admin", "ops"),
  validateParams(userIdParamSchema),
  validateBody(deactivateUserSchema),
  controller.deactivateUser,
);

adminUsersRouter.post(
  "/:id/reactivate",
  requireAdminRole("super_admin", "ops"),
  validateParams(userIdParamSchema),
  controller.reactivateUser,
);

// Diagnostic — fires one non-critical push to every device the user's
// household has registered. Use to verify push delivery after a user
// reports notifications aren't arriving. super_admin + ops only.
adminUsersRouter.post(
  "/:id/test-push",
  requireAdminRole("super_admin", "ops"),
  validateParams(userIdParamSchema),
  controller.sendTestPush,
);
