import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import type { FoodSearchQuery } from "./foods.validation.js";
import * as service from "./foods.service.js";

export const searchFoods = async (req: Request, res: Response): Promise<void> => {
  // validateQuery has already coerced + defaulted the query string.
  const q = req.query as unknown as FoodSearchQuery;
  const results = await service.searchFoodItems({ q: q.q, lang: q.lang, limit: q.limit });
  ok(res, { data: results });
};
