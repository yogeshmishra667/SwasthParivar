import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import { validateBody, validateQuery } from "../../shared/validate.js";
import { mealCreateSchema, listMealsQuerySchema } from "./meals.validation.js";
import * as controller from "./meals.controller.js";

export const mealsRouter: Router = Router();

mealsRouter.use(requireAuth);

mealsRouter.post("/", validateBody(mealCreateSchema), controller.postMeal);
mealsRouter.get("/", validateQuery(listMealsQuerySchema), controller.getMeals);
mealsRouter.delete("/:id", controller.deleteMeal);
