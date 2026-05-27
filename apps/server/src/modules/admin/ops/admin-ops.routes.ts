import { Router } from "express";
import { validateBody } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import { maintenanceSchema } from "./admin-ops.validation.js";
import * as controller from "./admin-ops.controller.js";

// Mounted at /admin/ops behind requireAdminAuth. Ops is super_admin + ops
// only (RBAC table in docs/admin-dashboard-plan.md).
export const adminOpsRouter: Router = Router();

adminOpsRouter.use(requireAdminRole("super_admin", "ops"));

adminOpsRouter.get("/queues", controller.getQueues);
adminOpsRouter.get("/health", controller.getHealth);
adminOpsRouter.post("/maintenance", validateBody(maintenanceSchema), controller.setMaintenance);
