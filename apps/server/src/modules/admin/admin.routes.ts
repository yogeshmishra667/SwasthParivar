import { Router } from "express";
import cookieParser from "cookie-parser";
import { requireAdminAuth } from "../../shared/middleware/admin-rbac.js";
import { adminAuthRouter } from "./auth/admin-auth.routes.js";
import { adminUsersRouter } from "./users/admin-users.routes.js";
import { adminAnalyticsRouter } from "./analytics/admin-analytics.routes.js";
import { adminFlagsRouter } from "./flags/admin-flags.routes.js";
import { adminOpsRouter } from "./ops/admin-ops.routes.js";
import { adminAdminsRouter } from "./admins/admin-admins.routes.js";
import { adminAuditRouter } from "./audit/admin-audit.routes.js";

export const adminRouter = Router();

// The refresh token rides in an httpOnly cookie scoped to /admin/auth;
// cookie-parser is mounted here (not globally) so only /admin needs it.
adminRouter.use(cookieParser());

// Auth endpoints (login / TOTP / refresh) must be reachable WITHOUT an
// admin token — they are what mints it. /me inside this router guards
// itself with requireAdminAuth.
adminRouter.use("/auth", adminAuthRouter);

// Everything past this point requires a valid admin session. Per-route
// RBAC role gates live inside each sub-router.
adminRouter.use(requireAdminAuth);

// Patient user inspection — list/search, the 360° detail view, the
// registry-driven resource panels, and tier changes.
adminRouter.use("/users", adminUsersRouter);

// Analytics — registry-driven KPI metrics (overview + per-metric).
adminRouter.use("/analytics", adminAnalyticsRouter);

// Feature-flag & rollout control plane — list/read/write, audit timeline,
// one-click rollback, rollout preview, atomic cohort edits.
adminRouter.use("/flags", adminFlagsRouter);

// Ops — BullMQ queue depth, system-health probe, maintenance kill switch.
adminRouter.use("/ops", adminOpsRouter);

// Admin-account management (RBAC).
adminRouter.use("/admins", adminAdminsRouter);

// Unified admin audit trail.
adminRouter.use("/audit", adminAuditRouter);
