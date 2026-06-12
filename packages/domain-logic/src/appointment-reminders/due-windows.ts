// Phase 4 Feature G.3 — `dueReminderWindows`, pure.
//
// Decides which of the 7d / 1d / 2h reminders an appointment should fire
// on this tick. The hourly cron calls this per still-pending appointment
// and acts on the result (push + flip the matching sent-flag).
//
// Bucket semantics — each window owns a disjoint slice of the lead-up:
//
//   7d window:  scheduledAt − 7d  ≤ now < scheduledAt − 1d
//   1d window:  scheduledAt − 1d  ≤ now < scheduledAt − 2h
//   2h window:  scheduledAt − 2h  ≤ now < scheduledAt
//
// Consequences that matter:
//   - At most one window is "due" at any instant (buckets don't overlap),
//     so the function returns 0 or 1 windows in practice — but the array
//     shape keeps the caller honest if the buckets ever change.
//   - An appointment booked only 3 days out lands in the 7d bucket, so it
//     gets ONE "upcoming" reminder, not a nonsensical "in 7 days" one —
//     the copy layer phrases the 7d bucket generically.
//   - An appointment booked 1 hour out lands in the 2h bucket: only the
//     final reminder fires; the 7d/1d buckets are already in the past.
//   - Past appointments (now ≥ scheduledAt) produce nothing.
//   - A window already marked sent never re-fires (idempotent across the
//     many hourly ticks that fall inside one bucket).

import type { DueWindowsInput, ReminderWindow } from "./types.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Lead time of each window before the appointment, in millis. */
export const REMINDER_OFFSETS_MS: Record<ReminderWindow, number> = {
  "7d": 7 * DAY_MS,
  "1d": 1 * DAY_MS,
  "2h": 2 * HOUR_MS,
};

// Coarse → fine. Each window's bucket runs from its own offset up to the
// next finer window's offset (0 for the last one).
const ORDERED: readonly ReminderWindow[] = ["7d", "1d", "2h"];

export const dueReminderWindows = (input: DueWindowsInput): ReminderWindow[] => {
  const { scheduledAtMs, nowMs, sent } = input;
  const due: ReminderWindow[] = [];

  for (let i = 0; i < ORDERED.length; i += 1) {
    const window = ORDERED[i]!;
    if (sent[window]) continue;

    const bucketOpensAt = scheduledAtMs - REMINDER_OFFSETS_MS[window];
    // The next finer window's offset bounds this bucket; the last window
    // runs right up to the appointment time.
    const nextFiner = ORDERED[i + 1];
    const bucketClosesAt = nextFiner
      ? scheduledAtMs - REMINDER_OFFSETS_MS[nextFiner]
      : scheduledAtMs;

    if (nowMs >= bucketOpensAt && nowMs < bucketClosesAt) {
      due.push(window);
    }
  }

  return due;
};
