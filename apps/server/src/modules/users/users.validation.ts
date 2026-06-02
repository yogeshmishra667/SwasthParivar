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

// Mobile-syncable preferences. All fields optional — the client sends a
// partial body containing just the field that changed. Enums are kept
// in lock-step with the mobile shape so a typo on either side surfaces
// as a 400, not a silent persist.
export const updatePreferencesSchema = z
  .object({
    theme: z.enum(["light", "dark", "system", "high-contrast"]).optional(),
    largeText: z.boolean().optional(),
    reduceMotion: z.boolean().optional(),
    checkFrequency: z.enum(["daily", "twice_weekly", "weekly", "biweekly", "monthly"]).optional(),
    notificationsEnabled: z.boolean().optional(),
    // "HH:MM" 24-hour, or explicit null to clear.
    reminderTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .nullable()
      .optional(),
  })
  .strict();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
