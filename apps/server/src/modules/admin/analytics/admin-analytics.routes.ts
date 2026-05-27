import { Router } from "express";
import { validateParams } from "../../../shared/validate.js";
import { metricKeyParamSchema } from "./admin-analytics.validation.js";
import * as controller from "./admin-analytics.controller.js";

// Mounted at /admin/analytics behind requireAdminAuth. Analytics is
// read-only and open to every authenticated role (incl. analyst).
export const adminAnalyticsRouter: Router = Router();

adminAnalyticsRouter.get("/overview", controller.overview);
adminAnalyticsRouter.get("/:key", validateParams(metricKeyParamSchema), controller.metric);
