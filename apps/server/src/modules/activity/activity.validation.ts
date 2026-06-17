import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// `source` has NO default — a missing source is a 400, per CLAUDE.md
// "Wearable Trust Model: source tag is mandatory in every payload;
// missing source → 400".
export const activityCreateSchema = z.object({
  date: dateOnly,
  steps: z.number().int().min(0).max(200_000),
  distanceMeters: z.number().int().min(0).max(1_000_000),
  activeMinutes: z.number().int().min(0).max(1_440),
  source: z.enum(["manual", "healthkit", "googlefit"]),
  /** Shared-phone profile switcher: log on behalf of a household member. */
  targetUserId: z.string().uuid().optional(),
});

export const listActivityQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  targetUserId: z.string().uuid().optional(),
});

export type ActivityCreateBody = z.infer<typeof activityCreateSchema>;
