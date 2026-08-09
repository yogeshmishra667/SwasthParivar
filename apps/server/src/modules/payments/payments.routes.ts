import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import * as controller from "./payments.controller.js";

// Patient-facing billing routes — mounted at /api/v1/payments.
export const paymentsRouter: Router = Router();
paymentsRouter.use(requireAuth);
paymentsRouter.get("/subscription", controller.getSubscription);
paymentsRouter.post("/razorpay/create-subscription", controller.createSubscription);
paymentsRouter.post("/apple-iap/verify-receipt", controller.verifyAppleReceipt);

// Provider webhooks — mounted at /api/v1/webhooks. NO requireAuth: the
// payload is authenticated by its provider signature (phase4.md §K.2).
export const webhooksRouter: Router = Router();
webhooksRouter.post("/razorpay", controller.razorpayWebhook);
webhooksRouter.post("/apple-iap", controller.appleWebhook);
