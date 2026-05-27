import { Router } from "express";
import cookieParser from "cookie-parser";
import { validateBody } from "../../../shared/validate.js";
import { authRateLimit } from "../../../shared/middleware/rate-limit.js";
import { requireAdminAuth } from "../../../shared/middleware/admin-rbac.js";
import {
  adminLoginSchema,
  adminTotpEnrollSchema,
  adminTotpCodeSchema,
} from "./admin-auth.validation.js";
import * as controller from "./admin-auth.controller.js";
import { csrfProtection, issueCsrfToken } from "./admin-csrf.js";

// Mounted at /admin/auth. Login + the TOTP step + refresh are reachable
// without an admin token (that is the point — they mint the token).
// authRateLimit (10/min) blunts password / code brute-forcing. Only /me
// is guarded, by `requireAdminAuth`.
export const adminAuthRouter: Router = Router();

// cookieParser is scoped to /admin/auth — the only sub-router that
// reads or writes cookies (refresh token + CSRF). Data routes
// (/admin/users, /admin/flags, …) never see cookies, so a future
// cookie-related vulnerability cannot reach them.
adminAuthRouter.use(cookieParser());

// `csurf` is applied to every route below. It transparently passes
// GET / HEAD / OPTIONS (so the /csrf endpoint itself works) and
// validates the `x-csrf-token` header on state-changing methods.
adminAuthRouter.use(csrfProtection);

// Mint a CSRF token (sets / refreshes the matching cookie). Public +
// idempotent — the client calls this on boot and on a 403 retry.
adminAuthRouter.get("/csrf", issueCsrfToken);

adminAuthRouter.post("/login", authRateLimit, validateBody(adminLoginSchema), controller.postLogin);
adminAuthRouter.post(
  "/totp/enroll",
  authRateLimit,
  validateBody(adminTotpEnrollSchema),
  controller.postTotpEnroll,
);
adminAuthRouter.post(
  "/totp/confirm",
  authRateLimit,
  validateBody(adminTotpCodeSchema),
  controller.postTotpConfirm,
);
adminAuthRouter.post(
  "/totp/verify",
  authRateLimit,
  validateBody(adminTotpCodeSchema),
  controller.postTotpVerify,
);
adminAuthRouter.post("/refresh", controller.postRefresh);
adminAuthRouter.post("/logout", controller.postLogout);
adminAuthRouter.get("/me", requireAdminAuth, controller.getMe);
