// Local glucose-check reminders, driven by the user's
// `checkFrequency` + `reminderTime` + `notificationsEnabled`
// preferences. Sibling to `medication-reminders.ts`.
//
// Why client-side scheduling:
//   The preference store lives in AsyncStorage and is not synced to
//   the backend (documented gap — see audit). The server therefore
//   cannot honour the user's chosen frequency on push delivery.
//   Scheduling the reminder locally side-steps that entirely: the
//   OS fires it at the configured time on the configured days, no
//   network required.
//
//   Server-side push reminders (best_log_time, streak-risk,
//   missed-day) remain INDEPENDENT — those are behaviour-aware
//   nudges that should override any user-selected frequency.
//
// Identifier scheme:
//   `check-<slot>` — single namespace so reconcile/cancel can
//   discover everything without a separate index. Slot encodes
//   the recurrence type: `daily`, `weekly-<weekday>`, `monthly`,
//   `date-<iso>`.

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { i18n } from "@/i18n/config";
import { logError } from "@/services/analytics";
import { isExpoGo } from "@/utils/runtime";
import type { CheckFrequency } from "@/utils/checkFrequency";

const ID_PREFIX = "check-";

const isOurReminderId = (id: string): boolean => id.startsWith(ID_PREFIX);

const ensurePermission = async (): Promise<boolean> => {
  if (isExpoGo || !Device.isDevice) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
};

const parseSlot = (slot: string): { hour: number; minute: number } | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
};

/** Cancels every previously-scheduled glucose-check reminder. */
export const cancelCheckReminders = async (): Promise<void> => {
  if (isExpoGo) return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      if (isOurReminderId(n.identifier)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (err) {
    logError("check-reminders.cancel", err);
  }
};

const BIWEEKLY_OCCURRENCES_AHEAD = 8;
const BIWEEKLY_ANCHOR_WEEKDAY = 1; // Sunday in expo (1=Sun … 7=Sat)

interface SyncInput {
  enabled: boolean;
  frequency: CheckFrequency;
  /** "HH:MM" — when in the day the reminder fires. null = 07:00 default. */
  reminderTime: string | null;
}

/**
 * Next occurrence of `weekday` (1=Sun…7=Sat) at `hour:minute` in the
 * device's local timezone, in the future (today only if hour:minute
 * has not yet passed).
 */
const nextWeekdayAt = (weekday: number, hour: number, minute: number): Date => {
  const now = new Date();
  const targetJsWeekday = weekday - 1; // expo 1=Sun → JS 0=Sun
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  const daysAhead = (targetJsWeekday - now.getDay() + 7) % 7;
  if (daysAhead === 0 && d.getTime() <= now.getTime()) {
    // Today's slot already passed → next week's same weekday.
    d.setDate(d.getDate() + 7);
  } else {
    d.setDate(d.getDate() + daysAhead);
  }
  return d;
};

/**
 * Sync local glucose-check reminders to the user's preferences. Cancels
 * every existing `check-*` reminder first, then schedules fresh ones
 * matching the new (frequency, time, enabled) tuple. Idempotent — safe
 * to call on every preference change AND on app foreground.
 */
export const syncCheckReminders = async (input: SyncInput): Promise<void> => {
  if (isExpoGo) return;

  await cancelCheckReminders();

  if (!input.enabled) return;

  const granted = await ensurePermission();
  if (!granted) return;

  const time = parseSlot(input.reminderTime ?? "07:00") ?? { hour: 7, minute: 0 };

  const title = i18n.t("notifications.glucoseCheck.title", {
    defaultValue: "Sugar check ka time",
  });
  const body = i18n.t("notifications.glucoseCheck.body", {
    defaultValue: "Aaj ki reading log karein 🙏",
  });
  const content = { title, body, sound: true };

  try {
    switch (input.frequency) {
      case "daily": {
        await Notifications.scheduleNotificationAsync({
          identifier: `${ID_PREFIX}daily`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: time.hour,
            minute: time.minute,
          },
        });
        break;
      }
      case "twice_weekly": {
        // Mon (2) + Thu (5) — common "twice-weekly" pattern with
        // ~3.5 day spacing.
        for (const weekday of [2, 5]) {
          await Notifications.scheduleNotificationAsync({
            identifier: `${ID_PREFIX}weekly-${weekday}`,
            content,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday,
              hour: time.hour,
              minute: time.minute,
            },
          });
        }
        break;
      }
      case "weekly": {
        await Notifications.scheduleNotificationAsync({
          identifier: `${ID_PREFIX}weekly-1`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: 1, // Sunday
            hour: time.hour,
            minute: time.minute,
          },
        });
        break;
      }
      case "biweekly": {
        // expo-notifications has no native "every other week" trigger.
        // Pre-stock concrete DATE triggers; the reconcile call on app
        // foreground refills the queue before it empties.
        const anchor = nextWeekdayAt(BIWEEKLY_ANCHOR_WEEKDAY, time.hour, time.minute);
        for (let i = 0; i < BIWEEKLY_OCCURRENCES_AHEAD; i++) {
          const fireAt = new Date(anchor.getTime() + i * 14 * 24 * 3_600_000);
          await Notifications.scheduleNotificationAsync({
            identifier: `${ID_PREFIX}date-${fireAt.toISOString()}`,
            content,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
            },
          });
        }
        break;
      }
      case "monthly": {
        await Notifications.scheduleNotificationAsync({
          identifier: `${ID_PREFIX}monthly`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
            day: 1, // 1st of each month
            hour: time.hour,
            minute: time.minute,
          },
        });
        break;
      }
    }
  } catch (err) {
    logError("check-reminders.schedule", err);
  }
};
