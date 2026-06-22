import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./payments.service.js";

// Razorpay → us. Unauthenticated: the request is authenticated by its
// HMAC signature, verified against RAZORPAY_WEBHOOK_SECRET in the
// service (invalid → 401, no state change).
export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const result = await service.processRazorpayWebhook({
    rawBody: req.rawBody ?? Buffer.alloc(0),
    signature: req.header("x-razorpay-signature"),
    eventId: req.header("x-razorpay-event-id"),
  });
  ok(res, result);
};

// Patient-facing: the current subscription for the logged-in user.
export const getSubscription = async (req: Request, res: Response): Promise<void> => {
  const subscription = await service.getSubscriptionForUser(req.auth!.sub);
  ok(res, { subscription });
};
