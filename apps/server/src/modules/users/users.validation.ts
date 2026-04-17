import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  age: z.number().int().min(1).max(120).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  conditions: z.array(z.enum(["diabetes", "hypertension", "asthma", "cardiac"])).optional(),
  preferredLanguage: z.enum(["hi", "en"]).optional(),
  timezone: z.string().max(50).optional(),
  onboardingStep: z.number().int().min(0).max(10).optional(),
  onboardingComplete: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
