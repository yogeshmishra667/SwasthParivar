import { Router } from "express";
import { validateBody } from "../../../shared/validate.js";
import { authRateLimit } from "../../../shared/middleware/rate-limit.js";
import { requireAdminAuth } from "../../../shared/middleware/admin-rbac.js";
import {
  adminLoginSchema,
  adminTotpEnrollSchema,
  adminTotpCodeSchema,
} from "./admin-auth.validation.js";
import * as controller from "./admin-auth.controller.js";

// Mounted at /admin/auth. Login + the TOTP step + refresh are reachable
// without an admin token (that is the point — they mint the token).
// authRateLimit (10/min) blunts password / code brute-forcing. Only /me
// is guarded, by `requireAdminAuth`.
export const adminAuthRouter: Router = Router();

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
