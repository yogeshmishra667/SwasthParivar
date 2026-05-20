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
