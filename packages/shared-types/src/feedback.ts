export type FeedbackTone = "celebrate" | "neutral" | "gentle_warn" | "encourage";

export type FeedbackType =
  | "first_reading"
  | "post_log_compare"
  | "streak_milestone"
  | "critical_warn"
  | "festive";

export interface FeedbackEvent {
  tone: FeedbackTone;
  type: FeedbackType;
  messageKey: string;
  variantIndex: number;
  params: Record<string, string | number>;
}
