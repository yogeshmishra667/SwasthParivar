import { Router } from "express";
import cookieParser from "cookie-parser";
import { requireAdminAuth, requireAdminRole } from "../../shared/middleware/admin-rbac.js";
import { adminAuthRouter } from "./auth/admin-auth.routes.js";
import * as flags from "./flags.controller.js";

export const adminRouter = Router();

// The refresh token rides in an httpOnly cookie scoped to /admin/auth;
// cookie-parser is mounted here (not globally) so only /admin needs it.
adminRouter.use(cookieParser());

// Auth endpoints (login / TOTP / refresh) must be reachable WITHOUT an
// admin token — they are what mints it. /me inside this router guards
// itself with requireAdminAuth.
adminRouter.use("/auth", adminAuthRouter);

// Everything past this point requires a valid admin session.
adminRouter.use(requireAdminAuth);

// Feature flags. Reads are open to every authenticated role; writes and
// the audit trail are limited to super_admin + ops (see the RBAC table
// in docs/admin-dashboard-plan.md).
adminRouter.get("/flags", flags.list);
adminRouter.get("/flags/:key", flags.getOne);
adminRouter.put("/flags/:key", requireAdminRole("super_admin", "ops"), flags.set);
adminRouter.get("/flags/:key/audit", requireAdminRole("super_admin", "ops"), flags.audit);
