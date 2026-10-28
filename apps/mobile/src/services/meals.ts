// Phase 2 — Meal log service. Quick-log surface (light / normal /
// heavy_fried) drives the meal-correlation detector on the server.
// Online-first; a log the server didn't answer for (network, 5xx, expired
// session) is stored in the offline queue (`services/pending-writes.ts`,
// audit P8) and sent later. Rejected on any other 4xx.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { MealCategory, MealType } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { enqueuePendingWrite } from "@/services/pending-writes";
import { classifyDrainFailure } from "@/services/drain-policy";

export interface SaveMealInput {
  userId: string;
  mealType: MealType;
  mealCategory: MealCategory;
  foodDescription?: string;
  loggedAtIso: string;
}

export type SaveMealResult =
  | { kind: "synced"; mealId: string }
  /** Stored on the phone; sent when the server answers again. */
  | { kind: "queued"; clientUuid: string }
  /** No answer from the server AND it couldn't be stored on the phone. */
  | { kind: "network_failed" }
  | { kind: "rejected"; status: number; code: string | null; message: string };

interface ServerMealResponse {
  success: boolean;
  data: { meal: { id: string } };
}

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
  };

  try {
    const res = await api.post<ServerMealResponse>("/meals", payload);
    track("meal_logged", {
      type: input.mealType,
      category: input.mealCategory,
      offline: false,
    });
    return { kind: "synced", mealId: res.data.meal.id };
  } catch (err) {
    if (classifyDrainFailure(err) === "abort") {
      const stored = await enqueuePendingWrite({
        kind: "meal",
        payload,
        critical: false,
        takenAtIso: input.loggedAtIso,
      });
      track("meal_logged", {
        type: input.mealType,
        category: input.mealCategory,
        offline: true,
        stored,
      });
      return stored ? { kind: "queued", clientUuid } : { kind: "network_failed" };
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
