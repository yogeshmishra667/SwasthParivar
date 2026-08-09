import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./payments.service.js";
import * as appleService from "./apple-iap.service.js";
import { createSubscriptionSchema, verifyReceiptSchema } from "./payments.validation.js";

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

// Patient-facing: start a subscription on Razorpay's side and return the
// checkout config. Tier does not change until the activation webhook.
export const createSubscription = async (req: Request, res: Response): Promise<void> => {
  const { tier } = createSubscriptionSchema.parse(req.body);
  const result = await service.createRazorpaySubscriptionForUser({
    userId: req.auth!.sub,
    tier,
  });
  ok(res, result, 201);
};

// Apple → us. Unauthenticated: the App Store Server Notification V2 is
// authenticated by its signed JWS (verified against the Apple root in
// the service; invalid → 401, no state change).
export const appleWebhook = async (req: Request, res: Response): Promise<void> => {
  const signedPayload =
    typeof (req.body as { signedPayload?: unknown } | undefined)?.signedPayload === "string"
      ? (req.body as { signedPayload: string }).signedPayload
      : undefined;
  const result = await appleService.processAppleWebhook({ signedPayload });
  ok(res, result);
};

// Patient-facing: validate a StoreKit receipt with Apple and apply the
// resulting tier. Never trusts the client's claim without validation.
export const verifyAppleReceipt = async (req: Request, res: Response): Promise<void> => {
  const { receiptData } = verifyReceiptSchema.parse(req.body);
  const result = await appleService.verifyAppleReceiptForUser({
    userId: req.auth!.sub,
    receiptData,
  });
  ok(res, result, 201);
};
