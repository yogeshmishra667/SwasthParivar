import { Router } from "express";
import { validateBody } from "../../shared/validate.js";
import { authRateLimit } from "../../shared/middleware/rate-limit.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import {
  pushTokenSchema,
  refreshTokenSchema,
  sendOtpSchema,
  verifyFirebaseSchema,
  verifyOtpSchema,
} from "./auth.validation.js";
import * as controller from "./auth.controller.js";

export const authRouter: Router = Router();

// Unauthenticated config endpoint — mobile calls this on launch (before
// login) to decide which OTP flow to render. Cheap to serve, hits the
// Redis-backed flag cache (30s TTL) so the load is negligible.
authRouter.get("/config", controller.getConfig);

authRouter.post("/send-otp", authRateLimit, validateBody(sendOtpSchema), controller.postSendOtp);
authRouter.post(
  "/verify-otp",
  authRateLimit,
  validateBody(verifyOtpSchema),
  controller.postVerifyOtp,
);
// Used only when auth.otp.provider = "firebase". Body is the ID token
// from the mobile Firebase SDK's signInWithPhoneNumber confirm step.
authRouter.post(
  "/verify-firebase",
  authRateLimit,
  validateBody(verifyFirebaseSchema),
  controller.postVerifyFirebase,
);
authRouter.post("/refresh", validateBody(refreshTokenSchema), controller.postRefresh);
authRouter.post(
  "/push-token",
  requireAuth,
  validateBody(pushTokenSchema),
  controller.postPushToken,
);
