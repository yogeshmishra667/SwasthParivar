export type NotificationTriggerType =
  | "critical_low_high"
  | "streak_risk"
  | "missed_day"
  | "best_time"
  | "generic_morning"
  | "med_reminder";

export const NOTIFICATION_PRIORITY: Record<NotificationTriggerType, number> = {
  critical_low_high: 1,
  streak_risk: 2,
  missed_day: 3,
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
  notificationHistory7d: Array<{ at: string; type: NotificationTriggerType; messageKey: string }>;
  last3VariantIds: string[];
}

export interface NotificationCandidate {
  trigger: NotificationTriggerType;
  messageKey: string;
  scheduledFor: string;
  params: Record<string, string | number>;
}
