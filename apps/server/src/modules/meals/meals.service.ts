import { DomainError } from "@swasth/shared-types";
import type { MealLog, MealCategory, Prisma } from "@prisma/client";
import { prisma } from "../../shared/database.js";

interface CreateMealInput {
  userId: string;
  clientUuid: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  mealCategory: "light" | "normal" | "heavy_fried";
  foodDescription?: string | undefined;
  /** Phase 4 §H — optional canonical IndianFoodItem link. */
  foodItemId?: string | undefined;
  loggedAt: string;
  version: number;
}

export interface CreateMealResult {
  meal: MealLog;
}

export const createMealLog = async (input: CreateMealInput): Promise<CreateMealResult> => {
  const existing = await prisma.mealLog.findFirst({
    where: { clientUuid: input.clientUuid },
  });

  if (existing && input.version <= existing.version) {
    throw new DomainError("MEAL_STALE_VERSION", "incoming version not newer than stored");
  }

  // Validate the optional food link up-front so a bad id surfaces as a
  // clean 404 instead of a raw FK violation (P2003 → 500). The free-text
  // `foodDescription` path is unaffected — foodItemId is purely additive.
  if (input.foodItemId !== undefined) {
    const food = await prisma.indianFoodItem.findUnique({
      where: { id: input.foodItemId },
      select: { id: true },
    });
    if (!food) {
      throw new DomainError("FOOD_ITEM_NOT_FOUND", "referenced food item does not exist");
    }
  }

  // The update path deliberately preserves logged_at — it is the
  // TimescaleDB partition key. Anything that would shift logged_at goes
  // through DELETE + create.
  const meal = existing
    ? await prisma.mealLog.update({
        where: {
          clientUuid_loggedAt: {
            clientUuid: existing.clientUuid,
            loggedAt: existing.loggedAt,
          },
        },
        data: {
          mealType: input.mealType,
          mealCategory: input.mealCategory,
          ...(input.foodDescription !== undefined
            ? { foodDescription: input.foodDescription }
            : {}),
          ...(input.foodItemId !== undefined ? { foodItemId: input.foodItemId } : {}),
          version: input.version,
        },
      })
    : await prisma.mealLog.create({
        data: {
          clientUuid: input.clientUuid,
          mealType: input.mealType,
          mealCategory: input.mealCategory,
          ...(input.foodDescription !== undefined
            ? { foodDescription: input.foodDescription }
            : {}),
          ...(input.foodItemId !== undefined
            ? { foodItem: { connect: { id: input.foodItemId } } }
            : {}),
          loggedAt: new Date(input.loggedAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });

  return { meal };
};

export const deleteMealLog = async (params: { userId: string; id: string }): Promise<void> => {
  const existing = await prisma.mealLog.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("MEAL_NOT_FOUND", "meal log does not exist");
  }
  await prisma.mealLog.delete({
    where: {
      clientUuid_loggedAt: {
        clientUuid: existing.clientUuid,
        loggedAt: existing.loggedAt,
      },
    },
  });
};

export const listMealLogs = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
  mealCategory?: MealCategory;
}): Promise<{ data: MealLog[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.MealLogWhereInput = {
    userId: params.userId,
    ...(params.mealCategory ? { mealCategory: params.mealCategory } : {}),
    ...(params.from || params.to
      ? {
          loggedAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
  };

  const cursorClause = params.cursor
    ? (() => {
        const parts = params.cursor.split("_");
        const cuid = parts[0];
        const loggedAt = parts[1];
        if (!cuid || !loggedAt) {
          throw new DomainError("VALIDATION_ERROR", "malformed cursor");
        }
        return {
          skip: 1,
          cursor: {
            clientUuid_loggedAt: {
              clientUuid: cuid,
              loggedAt: new Date(loggedAt),
            },
          },
        };
      })()
    : {};

  const rows = await prisma.mealLog.findMany({
    where,
    orderBy: { loggedAt: "desc" },
    take: params.limit + 1,
    ...cursorClause,
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? `${last.clientUuid}_${last.loggedAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
