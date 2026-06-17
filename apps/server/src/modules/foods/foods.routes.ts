import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateQuery } from "../../shared/validate.js";
import { foodSearchQuerySchema } from "./foods.validation.js";
import * as controller from "./foods.controller.js";

export const foodsRouter: Router = Router();

foodsRouter.use(requireAuth);

// GET /api/v1/foods/search?q=&lang=&limit= (phase4.md §H.3)
foodsRouter.get("/search", validateQuery(foodSearchQuerySchema), controller.searchFoods);
