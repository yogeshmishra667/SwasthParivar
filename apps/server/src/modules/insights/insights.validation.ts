import { z } from "zod";

export const listInsightsQuerySchema = z.object({
  // Filter by severity — most useful for the mobile feed which surfaces
  // warn+critical first. Omit → all severities.
  severity: z.enum(["info", "warn", "critical"]).optional(),
  // Filter by acknowledged-or-not. Mobile feed defaults to unacknowledged.
  acknowledged: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  // Filter by pattern type if the UI grows per-type drilldowns.
  patternType: z
    .enum(["spike", "trend", "meal_correlation", "anomaly", "cross_condition"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  targetUserId: z.string().uuid().optional(),
});

export const acknowledgeInsightSchema = z.object({
  // Optional 👍 / 👎 signal — null/undefined when the user just dismisses
  // without rating. Drives the future "is this detector useful" metric.
  helpful: z.boolean().optional(),
});
