import { z } from "zod";

// Only paid tiers are purchasable — `free` is the absence of a
// subscription, not something you check out for.
export const createSubscriptionSchema = z.object({
  tier: z.enum(["premium", "family"]),
});

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;
