// Phase 2 — Meal log service. Quick-log surface (light / normal /
// heavy_fried) drives the meal-correlation detector on the server.
// Mirrors the BP service shape: online-first, queued on transient
// failure, rejected on 4xx.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { MealCategory, MealType } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";

export interface SaveMealInput {
  userId: string;
  mealType: MealType;
  mealCategory: MealCategory;
  foodDescription?: string;
  loggedAtIso: string;
}

export type SaveMealResult =
  | { kind: "synced"; mealId: string }
  | { kind: "queued"; clientUuid: string }
  | { kind: "rejected"; status: number; code: string | null; message: string };

interface ServerMealResponse {
  success: boolean;
  data: { meal: { id: string } };
}

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  return err.response.status >= 500;
};

export const saveMealLog = async (input: SaveMealInput): Promise<SaveMealResult> => {
  const clientUuid = uuidv4();
  const payload = {
    clientUuid,
    mealType: input.mealType,
    mealCategory: input.mealCategory,
    ...(input.foodDescription !== undefined ? { foodDescription: input.foodDescription } : {}),
    loggedAt: input.loggedAtIso,
    version: 1,
    targetUserId: input.userId,
  } as const;

  try {
    const res = await api.post<ServerMealResponse>("/meals", payload);
    track("meal_logged", {
      type: input.mealType,
      category: input.mealCategory,
      offline: false,
    });
    return { kind: "synced", mealId: res.data.meal.id };
  } catch (err) {
    if (isNetworkOrServerError(err)) {
      track("meal_logged", {
        type: input.mealType,
        category: input.mealCategory,
        offline: true,
      });
      return { kind: "queued", clientUuid };
    }
    if (isAxiosError(err) && err.response) {
      const data = err.response.data as { error?: { code?: string; message?: string } } | undefined;
      return {
        kind: "rejected",
        status: err.response.status,
        code: data?.error?.code ?? null,
        message: data?.error?.message ?? "Save failed",
      };
    }
    logError("saveMealLog", err);
    return { kind: "rejected", status: 0, code: null, message: "Unknown error" };
  }
};
