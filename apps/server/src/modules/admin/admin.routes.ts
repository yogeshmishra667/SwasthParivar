import { Router } from "express";
import { requireAdminAuth } from "../../shared/middleware/admin-rbac.js";
import { adminAuthRouter } from "./auth/admin-auth.routes.js";
import { adminUsersRouter } from "./users/admin-users.routes.js";
import { adminAnalyticsRouter } from "./analytics/admin-analytics.routes.js";
import { adminFlagsRouter } from "./flags/admin-flags.routes.js";
import { adminOpsRouter } from "./ops/admin-ops.routes.js";
import { adminAdminsRouter } from "./admins/admin-admins.routes.js";
import { adminAuditRouter } from "./audit/admin-audit.routes.js";

export const adminRouter = Router();

// cookie-parser is intentionally NOT mounted at this level — only the
// auth sub-router reads or writes cookies (refresh token + CSRF
// token). Scoping it to /admin/auth keeps the cookie-handling surface
// minimal and lets CodeQL reason that data routes are cookie-free.

// Auth endpoints (login / TOTP / refresh) must be reachable WITHOUT an
// admin token — they are what mints it. /me inside this router guards
// itself with requireAdminAuth.
adminRouter.use("/auth", adminAuthRouter);

// Intercept ?token= query parameter for Bull Board which is an HTML page
// and cannot send the Bearer token via headers. We issue a cookie so
// that Bull Board's internal AJAX requests also stay authenticated.
adminRouter.use("/queues", (req, res, next) => {
  let token = req.query.token as string | undefined;

  // If no token in query, try to read from the cookie we set earlier
  if (!token && req.headers.cookie) {
    const match = /(?:^| )bb_token=([^;]+)/.exec(req.headers.cookie);
    if (match) token = match[1];
  }

  if (token) {
    // Set a short-lived cookie (e.g. 1 hour) for the board
    res.cookie("bb_token", token, { path: "/admin/queues", maxAge: 3600000, httpOnly: true });
    req.headers.authorization = `Bearer ${token}`;
  }
  next();
});

// Everything past this point requires a valid admin session. Per-route
// RBAC role gates live inside each sub-router.
adminRouter.use(requireAdminAuth);

import { setupBullBoard } from "../../shared/bull-board.js";
import { requireAdminRole } from "../../shared/middleware/admin-rbac.js";
adminRouter.use("/queues", requireAdminRole("super_admin"), setupBullBoard());

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
