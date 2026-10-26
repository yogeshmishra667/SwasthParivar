// The app reports a tapped push (audit P11). CLAUDE.md "Opens from push →
// reset fatigue to 0", and the push is no longer counted as ignored.

import { recordNotificationOpened } from "@swasth/domain-logic";
import { prisma } from "../../shared/database.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import {
  persistNotificationState,
  toSharedNotificationState,
} from "../../shared/notifications/notification-state.js";

export const recordOpened = async (params: {
  userId: string;
  notificationId: string;
  now?: Date;
}): Promise<{ matched: boolean }> => {
  const row = await prisma.notificationState.findUnique({ where: { userId: params.userId } });
  if (!row) return { matched: false };
  const state = toSharedNotificationState(row);
  const entry = state.notificationHistory7d.find((h) => h.notificationId === params.notificationId);
  const nowIso = (params.now ?? new Date()).toISOString();
  await persistNotificationState(
    params.userId,
    recordNotificationOpened(state, params.notificationId, nowIso),
  );
  captureAnalyticsEvent("notification_opened", params.userId, {
    trigger_type: entry?.type ?? "unknown",
    source: "push",
  });
  return { matched: entry !== undefined };
};
