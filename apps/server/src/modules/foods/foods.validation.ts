import { z } from "zod";

// Languages we accept for search. `hi`/`en` always work against the
// always-present name_en / name_hi columns; the regional codes match
// keys in IndianFoodItem.name_regional and fall back to en+hi when the
// item has no entry for that language (Feature J populates them as each
// flag ramps — §H.1).
export const foodSearchLangs = ["en", "hi", "mr", "ta", "bn", "te", "gu", "pa"] as const;

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(50),
  lang: z.enum(foodSearchLangs).default("en"),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;
export type FoodSearchLang = (typeof foodSearchLangs)[number];
