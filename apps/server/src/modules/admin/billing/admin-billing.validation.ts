import { z } from "zod";

// Phase 4 §K.6 — admin billing console.

export const listSubscriptionsQuerySchema = z.object({
  status: z.enum(["active", "past_due", "grace", "cancelled"]).optional(),
  provider: z.enum(["razorpay", "apple_iap", "manual"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const refundParamsSchema = z.object({
  userId: z.uuid(),
});

export const refundBodySchema = z.object({
  // Mandatory reason — lands in the AdminAuditLog metadata.
  reason: z.string().min(3).max(500),
});
