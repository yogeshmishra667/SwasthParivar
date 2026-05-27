import { Router } from "express";
import { validateQuery } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import { listAuditQuerySchema } from "./admin-audit.validation.js";
import * as controller from "./admin-audit.controller.js";

// Mounted at /admin/audit behind requireAdminAuth. Viewing the admin
// audit trail is super_admin + ops only (RBAC table in the plan).
export const adminAuditRouter: Router = Router();

adminAuditRouter.get(
  "/",
  requireAdminRole("super_admin", "ops"),
  validateQuery(listAuditQuerySchema),
  controller.list,
);
