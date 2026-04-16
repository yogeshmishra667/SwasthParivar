import { Router } from "express";
import { validateBody } from "../../shared/validate.js";
import { authRateLimit } from "../../shared/middleware/rate-limit.js";
import { refreshTokenSchema, sendOtpSchema, verifyOtpSchema } from "./auth.validation.js";
import * as controller from "./auth.controller.js";

export const authRouter: Router = Router();

authRouter.post("/send-otp", authRateLimit, validateBody(sendOtpSchema), controller.postSendOtp);
authRouter.post("/verify-otp", authRateLimit, validateBody(verifyOtpSchema), controller.postVerifyOtp);
authRouter.post("/refresh", validateBody(refreshTokenSchema), controller.postRefresh);
