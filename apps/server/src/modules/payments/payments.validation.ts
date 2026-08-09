import { z } from "zod";

// Only paid tiers are purchasable — `free` is the absence of a
// subscription, not something you check out for.
export const createSubscriptionSchema = z.object({
  tier: z.enum(["premium", "family"]),
});

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;

// Apple IAP (§K.3) — the base64 receipt blob the client obtained from
// StoreKit. Validated server-side against Apple; never trusted as-is.
export const verifyReceiptSchema = z.object({
  receiptData: z.string().min(1),
});

export type VerifyReceiptBody = z.infer<typeof verifyReceiptSchema>;
