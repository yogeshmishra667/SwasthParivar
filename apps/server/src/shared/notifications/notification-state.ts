// NotificationState rows ↔ the shared (domain-logic) shape. Used by the
// trigger job and by the app's "notification opened" report (audit P11).

import type { NotificationState as SharedNotificationState } from "@swasth/shared-types";
import type { NotificationState as PrismaNotificationState } from "@prisma/client";
import { prisma } from "../database.js";

export const toSharedNotificationState = (s: PrismaNotificationState): SharedNotificationState => ({
  userId: s.userId,
  fatigueLevel: Math.min(3, Math.max(0, s.fatigueLevel)) as 0 | 1 | 2 | 3,
  consecutiveIgnores: s.consecutiveIgnores,
  lastNotificationAt: s.lastNotificationAt?.toISOString() ?? null,
  bestLogTimeFasting: s.bestLogTimeFasting,
  bestLogTimePostMeal: s.bestLogTimePostMeal,
  notificationHistory7d:
    (s.notificationHistory7d as SharedNotificationState["notificationHistory7d"]) ?? [],
  last3VariantIds: (s.last3VariantIds as string[]) ?? [],
});

export const persistNotificationState = async (
  userId: string,
  next: SharedNotificationState,
): Promise<void> => {
  await prisma.notificationState.update({
    where: { userId },
    data: {
      fatigueLevel: next.fatigueLevel,
      consecutiveIgnores: next.consecutiveIgnores,
      lastNotificationAt: next.lastNotificationAt ? new Date(next.lastNotificationAt) : null,
      bestLogTimeFasting: next.bestLogTimeFasting,
      bestLogTimePostMeal: next.bestLogTimePostMeal,
      notificationHistory7d: next.notificationHistory7d,
      last3VariantIds: next.last3VariantIds,
    },
  });
};
