import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import type { MealCategory } from "@prisma/client";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./meals.service.js";

export const postMeal = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    clientUuid: string;
    mealType: "breakfast" | "lunch" | "dinner" | "snack";
    mealCategory: "light" | "normal" | "heavy_fried";
    foodDescription?: string;
    loggedAt: string;
    version: number;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const { targetUserId: _drop, ...rest } = body;
  void _drop;
  const result = await service.createMealLog({ userId, ...rest });
  ok(res, result, 201);
};

export const deleteMeal = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") throw new DomainError("VALIDATION_ERROR", "id is required");
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  await service.deleteMealLog({ userId, id });
  ok(res, { deleted: true });
};

export const getMeals = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as {
    from?: string;
    to?: string;
    limit?: string | number;
    cursor?: string;
    mealCategory?: MealCategory;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listMealLogs({
    userId,
    ...(q.from ? { from: new Date(q.from) } : {}),
    ...(q.to ? { to: new Date(q.to) } : {}),
    limit: Number(q.limit ?? 50),
    ...(q.cursor ? { cursor: q.cursor } : {}),
    ...(q.mealCategory ? { mealCategory: q.mealCategory } : {}),
  });
  ok(res, result);
};
