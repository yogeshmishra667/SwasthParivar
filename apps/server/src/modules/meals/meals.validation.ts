import { z } from "zod";

export const mealCreateSchema = z.object({
  clientUuid: z.string().uuid(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  mealCategory: z.enum(["light", "normal", "heavy_fried"]),
  foodDescription: z.string().max(500).optional(),
  loggedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
  /** Shared-phone profile switcher: log on behalf of a household member. */
  targetUserId: z.string().uuid().optional(),
});

export const listMealsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  mealCategory: z.enum(["light", "normal", "heavy_fried"]).optional(),
  targetUserId: z.string().uuid().optional(),
});
