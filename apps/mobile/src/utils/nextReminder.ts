// Pure helpers for "when does the next check-frequency reminder fire?"
//
// Mirrors the scheduling logic in `services/check-reminders.ts` — the
// notification fires on the same cadence per frequency, anchored at the
// user's `reminderTime`. Kept as a pure function so any UI surface
// (post-save card, schedule chip, guardian dashboard) can compute it
// without touching the expo-notifications layer.
//
// Returns null when reminders are disabled OR when frequency/time are
// unset — callers treat null as "don't render this hint at all".

import type { TFunction } from "i18next";
import type { CheckFrequency } from "@/utils/checkFrequency";

const HOURS_24 = 24 * 60 * 60 * 1000;
const BIWEEKLY_ANCHOR_WEEKDAY = 0; // Sunday in JS Date (0=Sun … 6=Sat)
const TWICE_WEEKLY_DAYS = [1, 4] as const; // Mon, Thu (JS 0=Sun)
const WEEKLY_DAY = 0; // Sunday

const parseSlot = (slot: string): { hour: number; minute: number } | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
};

const setOfDay = (base: Date, hour: number, minute: number): Date => {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const nextWeekdayAt = (base: Date, targetWeekday: number, hour: number, minute: number): Date => {
  const candidate = setOfDay(base, hour, minute);
  const dayDelta = (targetWeekday - base.getDay() + 7) % 7;
  if (dayDelta === 0 && candidate.getTime() <= base.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  } else {
    candidate.setDate(candidate.getDate() + dayDelta);
  }
  return candidate;
};

/**
 * Compute the next time the check-frequency reminder will fire.
 * `now` is injectable so tests can pin the clock; defaults to real time.
 */
export const nextReminderAt = (params: {
  enabled: boolean;
  frequency: CheckFrequency;
  reminderTime: string | null;
  now?: Date;
}): Date | null => {
  if (!params.enabled) return null;
  const slot = parseSlot(params.reminderTime ?? "07:00");
  if (!slot) return null;
  const now = params.now ?? new Date();

  switch (params.frequency) {
    case "daily": {
      const today = setOfDay(now, slot.hour, slot.minute);
      if (today.getTime() > now.getTime()) return today;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    case "twice_weekly": {
      const candidates = TWICE_WEEKLY_DAYS.map((d) =>
        nextWeekdayAt(now, d, slot.hour, slot.minute),
      );
      candidates.sort((a, b) => a.getTime() - b.getTime());
      return candidates[0]!;
    }
    case "weekly": {
      return nextWeekdayAt(now, WEEKLY_DAY, slot.hour, slot.minute);
    }
    case "biweekly": {
      // Next anchor Sunday at slot. Within a week's tolerance of the
      // pre-stocked DATE triggers in check-reminders.ts — good enough
      // for a UX hint.
      return nextWeekdayAt(now, BIWEEKLY_ANCHOR_WEEKDAY, slot.hour, slot.minute);
    }
    case "monthly": {
      const candidate = new Date(now);
      candidate.setDate(1);
      candidate.setHours(slot.hour, slot.minute, 0, 0);
      if (candidate.getTime() <= now.getTime()) {
        candidate.setMonth(candidate.getMonth() + 1);
      }
      return candidate;
    }
  }
};

/**
 * Friendly localised label for the next reminder Date.
 *   "Aaj 7:30 PM" / "Kal 7:00 AM" / "Somvaar 7:00 AM" / "1 Apr, 7:00 AM"
 */
export const formatNextReminder = (nextAt: Date, t: TFunction, now: Date = new Date()): string => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(nextAt);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / HOURS_24);

  const timeLabel = nextAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (diffDays <= 0) {
    return `${t("nextReminder.today", { defaultValue: "Aaj" })} ${timeLabel}`;
  }
  if (diffDays === 1) {
    return `${t("nextReminder.tomorrow", { defaultValue: "Kal" })} ${timeLabel}`;
  }
  if (diffDays < 7) {
    const weekdayKey = `nextReminder.weekday.${nextAt.getDay()}`;
    const fallback = nextAt.toLocaleDateString(undefined, { weekday: "short" });
    return `${t(weekdayKey, { defaultValue: fallback })} ${timeLabel}`;
  }
  const dateLabel = nextAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${dateLabel}, ${timeLabel}`;
};

/** Short cadence label for the schedule chip. */
export const cadenceLabel = (frequency: CheckFrequency, t: TFunction): string => {
  switch (frequency) {
    case "daily":
      return t("nextReminder.cadence.daily", { defaultValue: "Daily" });
    case "twice_weekly":
      return t("nextReminder.cadence.twice_weekly", { defaultValue: "Mon + Thu" });
    case "weekly":
      return t("nextReminder.cadence.weekly", { defaultValue: "Weekly" });
    case "biweekly":
      return t("nextReminder.cadence.biweekly", { defaultValue: "Every 2 weeks" });
    case "monthly":
      return t("nextReminder.cadence.monthly", { defaultValue: "Monthly" });
  }
};
