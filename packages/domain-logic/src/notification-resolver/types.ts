import type {
  NotificationCandidate,
  NotificationState,
  NotificationTriggerType,
} from "@swasth/shared-types";

export interface ResolveInput {
  state: NotificationState;
  candidates: NotificationCandidate[];
  nowIso: string;
  /** The id the push will carry; kept in history so its open can be matched. */
  notificationId?: string;
}

export type ResolveResult =
  | { kind: "send"; chosen: NotificationCandidate; nextState: NotificationState }
  | { kind: "suppress"; reason: SuppressReason; nextState: NotificationState };

export type SuppressReason =
  | "duplicate_24h"
  | "throttled_30min"
  | "fatigue_max_per_day"
  | "fatigue_stop"
  | "no_candidates";

export type { NotificationTriggerType };
