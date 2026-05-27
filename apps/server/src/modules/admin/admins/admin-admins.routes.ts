import { Router } from "express";
import { validateBody, validateParams } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import {
  adminCreateSchema,
  adminIdParamSchema,
  adminResetPasswordSchema,
  adminUpdateSchema,
} from "./admin-admins.validation.js";
import * as controller from "./admin-admins.controller.js";

// Mounted at /admin/admins behind requireAdminAuth. Managing staff
// accounts is super_admin only (RBAC table in docs/admin-dashboard-plan.md).
export const adminAdminsRouter: Router = Router();

adminAdminsRouter.use(requireAdminRole("super_admin"));

adminAdminsRouter.get("/", controller.list);

adminAdminsRouter.post("/", validateBody(adminCreateSchema), controller.create);

adminAdminsRouter.patch(
  "/:id",
  validateParams(adminIdParamSchema),
  validateBody(adminUpdateSchema),
  controller.update,
);

adminAdminsRouter.post(
  "/:id/reset-password",
  validateParams(adminIdParamSchema),
  validateBody(adminResetPasswordSchema),
  controller.resetPassword,
);
