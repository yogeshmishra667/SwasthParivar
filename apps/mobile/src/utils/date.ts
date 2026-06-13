// Friendly relative-date formatting for list rows.
//
// Recent timestamps read as relative copy ("5 min ago", "Yesterday");
// anything a week or older falls back to an explicit short date
// ("20 May"). Copy is i18n-driven so it respects the app language.

import type { TFunction } from "i18next";

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const relativeDate = (iso: string, t: TFunction): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < MIN_MS) return t("chat.justNow");
  if (ms < HOUR_MS) return t("chat.date.minutesAgo", { count: Math.floor(ms / MIN_MS) });
  if (ms < DAY_MS) return t("chat.date.hoursAgo", { count: Math.floor(ms / HOUR_MS) });
  const days = Math.floor(ms / DAY_MS);
  if (days === 1) return t("chat.date.yesterday");
  if (days < 7) return t("chat.date.daysAgo", { count: days });
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

// Forward-looking date+time label for appointments ("Mon, 16 Jun · 2:00 PM").
// Uses the device locale via the same toLocale* options the rest of the
// app relies on.
export const appointmentDateTime = (iso: string): string => {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};
