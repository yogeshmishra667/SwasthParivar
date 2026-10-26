export type NotificationTriggerType =
  | "critical_low_high"
  | "streak_risk"
  | "missed_day"
  | "re_engagement"
  | "welcome_back"
  | "best_time"
  | "generic_morning"
  | "med_reminder";

export const NOTIFICATION_PRIORITY: Record<NotificationTriggerType, number> = {
  critical_low_high: 1,
  streak_risk: 2,
  missed_day: 3,
  // re_engagement covers days 3-7 of inactivity; same conceptual
  // priority as missed_day. They never appear together (different
  // day-since-log windows) so the slot collision is harmless.
  re_engagement: 3,
  // welcome_back fires when a returning user opens the app after a
  // long gap (≥3 days). Higher priority than best_time so it isn't
  // drowned by the next morning reminder.
  welcome_back: 2,
  best_time: 4,
  generic_morning: 5,
  med_reminder: 0,
};

export interface NotificationState {
  userId: string;
  fatigueLevel: 0 | 1 | 2 | 3;
  consecutiveIgnores: number;
  lastNotificationAt: string | null;
  bestLogTimeFasting: string;
  bestLogTimePostMeal: string;
  // Inline (not a named interface): it is stored as Prisma JSON, which needs
  // the implicit index signature only object type literals get.
  notificationHistory7d: {
    at: string;
    type: NotificationTriggerType;
    messageKey: string;
    /** The push's id, so an open the app reports can be matched to it. */
    notificationId?: string;
    /** When the app reported the push opened. */
    openedAt?: string;
    /** When it was counted as ignored (never opened). */
    ignoredAt?: string;
  }[];
  last3VariantIds: string[];
}

export type NotificationHistoryEntry = NotificationState["notificationHistory7d"][number];

export interface NotificationCandidate {
  trigger: NotificationTriggerType;
  messageKey: string;
  scheduledFor: string;
  params: Record<string, string | number>;
}

/**
 * Android notification channels — the single list the app creates at
 * startup and the server may send to. Android silently drops a push whose
 * `channelId` doesn't exist on the device (audit P10), so the server's
 * `ExpoPushMessage.channelId` is typed against this list.
 */
export const ANDROID_NOTIFICATION_CHANNELS = {
  default: { name: "General", importance: "high" },
  critical: { name: "Critical health alerts", importance: "max", bypassDnd: true },
  reminders: { name: "Reading reminders", importance: "default" },
  medications: { name: "Medicine reminders", importance: "high" },
  guardian: { name: "Family alerts", importance: "high" },
} as const;

export type AndroidChannelId = keyof typeof ANDROID_NOTIFICATION_CHANNELS;
