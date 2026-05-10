import { z } from "zod";

/**
 * Add-household-profile input.
 *
 * The new profile is a household member who shares the device with the
 * caller. They have no phone of their own — auth is owned by the caller's
 * phone-based JWT, and per-profile data is scoped by `active_user_id`
 * sent on each request (see `shared/middleware/auth.ts` once that
 * scoping middleware lands in PR #5).
 *
 * Conditions are limited to the Phase-1 Condition enum at the schema
 * level; the request only needs to carry the raw strings.
 */
export const addHouseholdProfileSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  age: z.number().int().min(0).max(120),
  gender: z.enum(["male", "female", "other"]).optional(),
  conditions: z
    .array(z.enum(["diabetes", "hypertension", "asthma", "cardiac"]))
    .min(1)
    .max(4),
  preferredLanguage: z.enum(["hi", "en"]).optional(),
});

export type AddHouseholdProfileInput = z.infer<typeof addHouseholdProfileSchema>;
