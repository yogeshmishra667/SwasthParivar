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
  notificationHistory7d: { at: string; type: NotificationTriggerType; messageKey: string }[];
  last3VariantIds: string[];
}

export interface NotificationCandidate {
  trigger: NotificationTriggerType;
  messageKey: string;
  scheduledFor: string;
  params: Record<string, string | number>;
}
