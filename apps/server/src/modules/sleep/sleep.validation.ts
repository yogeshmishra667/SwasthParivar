import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// `source` is mandatory (no default) — missing source → 400, per the
// CLAUDE.md wearable trust model.
export const sleepCreateSchema = z
  .object({
    date: dateOnly,
    sleepStart: z.string().datetime(),
    sleepEnd: z.string().datetime(),
    durationMinutes: z.number().int().min(0).max(1_440),
    quality: z.enum(["poor", "fair", "good"]),
    source: z.enum(["manual", "healthkit", "googlefit"]),
    /** Shared-phone profile switcher: log on behalf of a household member. */
    targetUserId: z.string().uuid().optional(),
  })
  .refine((v) => new Date(v.sleepEnd).getTime() > new Date(v.sleepStart).getTime(), {
    message: "sleepEnd must be after sleepStart",
    path: ["sleepEnd"],
  });

export const listSleepQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  targetUserId: z.string().uuid().optional(),
});

export type SleepCreateBody = z.infer<typeof sleepCreateSchema>;
