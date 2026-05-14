import { Router } from "express";
import { adminAuth } from "../../shared/middleware/admin-auth.js";
import * as flags from "./flags.controller.js";

export const adminRouter = Router();

// Every /admin route requires the bearer admin token. The middleware
// throws DomainError("AUTH_UNAUTHORIZED") on miss; the global error
// handler maps that to 403.
adminRouter.use(adminAuth);

adminRouter.get("/flags", flags.list);
adminRouter.get("/flags/:key", flags.getOne);
adminRouter.put("/flags/:key", flags.set);
adminRouter.get("/flags/:key/audit", flags.audit);
