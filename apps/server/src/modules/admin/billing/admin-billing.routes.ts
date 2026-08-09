import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "../../../shared/validate.js";
import { requireAdminRole } from "../../../shared/middleware/admin-rbac.js";
import {
  listSubscriptionsQuerySchema,
  refundBodySchema,
  refundParamsSchema,
} from "./admin-billing.validation.js";
import * as controller from "./admin-billing.controller.js";

// Mounted at /admin/billing behind requireAdminAuth (see admin.routes.ts).
// Read surfaces (table + metrics) are open to every authenticated admin
// role; the refund trigger is super_admin only and audited.
export const adminBillingRouter: Router = Router();

adminBillingRouter.get(
  "/subscriptions",
  validateQuery(listSubscriptionsQuerySchema),
  controller.listSubscriptions,
);

adminBillingRouter.get("/metrics", controller.getMetrics);

adminBillingRouter.post(
  "/subscriptions/:userId/refund",
  requireAdminRole("super_admin"),
  validateParams(refundParamsSchema),
  validateBody(refundBodySchema),
  controller.triggerRefund,
);
