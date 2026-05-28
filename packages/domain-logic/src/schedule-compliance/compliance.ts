// Phase 2 carry-over — pure `evaluateCompliance`.
//
// Given a HealthCheckSchedule (already in the input shape), a list of
// readings, a window start and a `now`, return per-slot verdicts +
// the next due slot. Fully pure: no Date.now(), no I/O, no globals.
//
// Algorithm:
//   1. Expand the schedule into absolute UTC slot timestamps inside
//      [windowStart, now + 1 frequency-step]. The +1 step is what
//      lets us return `nextDueAtIso` without a second pass.
//   2. Filter readings to the schedule's `checkType` and to the
//      [windowStart - on_time, now + on_time] band so the matcher
//      only sees readings that could plausibly match a window slot.
//   3. Greedy match: for each past slot in chronological order, claim
//      the earliest unclaimed reading inside its [-on_time, +late]
//      window. Tag the slot on_time / late / missed / pending using
//      the windows in `types.ts`.
//   4. Find the first future slot (>= now) for `nextDueAtIso`.
//
// The matcher is greedy by slot order, not by reading order. That
// matches the medical intent: a reading is the right one for the
// slot it falls in, not the slot that happens to claim it first.

import {
  COMPLIANCE_LATE_WINDOW_MINUTES,
  COMPLIANCE_MISSED_AFTER_MINUTES,
  COMPLIANCE_ON_TIME_WINDOW_MINUTES,
  type ComplianceEvaluation,
  type EvaluateInput,
  type ExpectedSlotEval,
  type ReadingForCompliance,
  type ScheduledSlot,
  type ScheduleInput,
} from "./types.js";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
/** Hard ceiling on how far forward `nextDueAtIso` scans past `now`.
 * 14 days is comfortably more than one weekly cycle (7d) and one
 * daily cycle, so any active schedule with at least one slot will
 * always resolve within this window. */
const NEXT_DUE_LOOKAHEAD_DAYS = 14;

/** Returns YYYY-MM-DD for the user-local date that contains `utcMs`. */
const userLocalDateKey = (utcMs: number, tzOffsetMinutes: number): string => {
  const userMs = utcMs + tzOffsetMinutes * MS_PER_MIN;
  const d = new Date(userMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/**
 * Convert a user-local wall clock (year, month0, day, hour, minute) to
 * absolute UTC ms. We do this by computing the user-time as if it
 * were UTC, then subtracting the user's offset. There is no DST in
 * IST and we don't pretend to handle it elsewhere either — same
 * simplification as `streak-engine`.
 */
const userWallToUtcMs = (
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  tzOffsetMinutes: number,
): number => Date.UTC(year, month0, day, hour, minute) - tzOffsetMinutes * MS_PER_MIN;

/** 0 = Sunday, 6 = Saturday — what `Date.getUTCDay()` returns. */
const userLocalDayOfWeek = (utcMs: number, tzOffsetMinutes: number): number => {
  const userMs = utcMs + tzOffsetMinutes * MS_PER_MIN;
  return new Date(userMs).getUTCDay();
};

/**
 * Expand a schedule into absolute UTC slot ms inside `[fromMs, toMs]`.
 * Returns sorted, deduplicated timestamps. Inactive schedules and
 * empty `scheduledTimes` arrays return an empty array — the caller
 * decides what to do with that (typically: skip persistence).
 */
const expandSlots = (schedule: ScheduleInput, fromMs: number, toMs: number): number[] => {
  if (!schedule.active || schedule.scheduledTimes.length === 0) return [];
  if (toMs < fromMs) return [];

  // Walk one user-local day at a time. We pad the start by a day on
  // each side so slots near the boundary aren't dropped when fromMs
  // lands mid-day.
  const startKey = userLocalDateKey(fromMs - MS_PER_DAY, schedule.userTzOffsetMinutes);
  const endKey = userLocalDateKey(toMs + MS_PER_DAY, schedule.userTzOffsetMinutes);
  const startParts = startKey.split("-").map(Number);
  const endParts = endKey.split("-").map(Number);
  const sy = startParts[0]!;
  const sm = startParts[1]!;
  const sd = startParts[2]!;
  const ey = endParts[0]!;
  const em = endParts[1]!;
  const ed = endParts[2]!;

  // Iterate from start date to end date in user-local space. We
  // anchor each iteration to noon-UTC of the user-shifted date to
  // dodge edge-of-day arithmetic; the wall-clock conversion uses the
  // raw y/m/d so noon-anchor never matters.
  const startNoon = Date.UTC(sy, sm - 1, sd, 12);
  const endNoon = Date.UTC(ey, em - 1, ed, 12);
  const out: number[] = [];

  for (let cursor = startNoon; cursor <= endNoon; cursor += MS_PER_DAY) {
    const d = new Date(cursor);
    const y = d.getUTCFullYear();
    const m0 = d.getUTCMonth();
    const day = d.getUTCDate();

    for (const slot of schedule.scheduledTimes) {
      validateSlot(schedule, slot);
      const slotMs = userWallToUtcMs(
        y,
        m0,
        day,
        slot.hour,
        slot.minute,
        schedule.userTzOffsetMinutes,
      );

      if (slotMs < fromMs || slotMs > toMs) continue;

      if (schedule.frequency === "weekly") {
        // validateSlot already threw on weekly + missing dayOfWeek, so
        // the non-null assertion is sound here.
        const wantDow = slot.dayOfWeek!;
        if (userLocalDayOfWeek(slotMs, schedule.userTzOffsetMinutes) !== wantDow) continue;
      }

      out.push(slotMs);
    }
  }

  // Multiple identical slots in `scheduledTimes` (user error) should
  // not create duplicate compliance rows. Sort + dedupe.
  out.sort((a, b) => a - b);
  return dedupSorted(out);
};

const dedupSorted = (arr: number[]): number[] => {
  if (arr.length < 2) return arr;
  const out: number[] = [arr[0]!];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i]!;
    if (cur !== arr[i - 1]) out.push(cur);
  }
  return out;
};

const validateSlot = (schedule: ScheduleInput, slot: ScheduledSlot): void => {
  if (!Number.isInteger(slot.hour) || slot.hour < 0 || slot.hour > 23) {
    throw new Error(`Invalid scheduled slot hour: ${slot.hour}`);
  }
  if (!Number.isInteger(slot.minute) || slot.minute < 0 || slot.minute > 59) {
    throw new Error(`Invalid scheduled slot minute: ${slot.minute}`);
  }
  if (schedule.frequency === "weekly") {
    if (slot.dayOfWeek === undefined) {
      throw new Error("Weekly schedule slot is missing required dayOfWeek (0-6)");
    }
    if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
      throw new Error(`Invalid scheduled slot dayOfWeek: ${slot.dayOfWeek}`);
    }
  }
};

/**
 * Greedy slot-first matcher. For each past slot in order, walk the
 * remaining (unclaimed) readings sorted by time and claim the first
 * one inside the slot's late window. A reading inside the on_time
 * band wins regardless of order; nothing in the on_time band falls
 * back to the late band.
 */
const matchReadingToSlot = (
  slotMs: number,
  readings: ReadingForCompliance[],
  claimed: Set<number>,
): { readingIdx: number; reading: ReadingForCompliance; minutesLate: number } | null => {
  const onTimeStart = slotMs - COMPLIANCE_ON_TIME_WINDOW_MINUTES * MS_PER_MIN;
  const onTimeEnd = slotMs + COMPLIANCE_ON_TIME_WINDOW_MINUTES * MS_PER_MIN;
  const lateEnd = slotMs + COMPLIANCE_LATE_WINDOW_MINUTES * MS_PER_MIN;

  let onTimeIdx = -1;
  let lateIdx = -1;

  for (let i = 0; i < readings.length; i++) {
    if (claimed.has(i)) continue;
    const r = readings[i]!;
    const ms = Date.parse(r.measuredAtIso);
    if (ms < onTimeStart) continue;
    // Readings are pre-sorted ascending — once we pass the late end
    // we will never find a match.
    if (ms > lateEnd) break;

    if (ms <= onTimeEnd) {
      onTimeIdx = i;
      break; // earliest on-time reading wins
    }
    if (lateIdx === -1) lateIdx = i; // earliest in late band
  }

  const winner = onTimeIdx !== -1 ? onTimeIdx : lateIdx;
  if (winner === -1) return null;

  const reading = readings[winner]!;
  const minutesLate = (Date.parse(reading.measuredAtIso) - slotMs) / MS_PER_MIN;
  return { readingIdx: winner, reading, minutesLate };
};

/**
 * Find the first slot at or after `nowMs`. Scans forward up to
 * `NEXT_DUE_LOOKAHEAD_DAYS` past `nowMs`; an active schedule with
 * at least one valid slot always resolves inside this window.
 */
const findNextDueMs = (schedule: ScheduleInput, nowMs: number): number | null => {
  const futureSlots = expandSlots(schedule, nowMs, nowMs + NEXT_DUE_LOOKAHEAD_DAYS * MS_PER_DAY);
  for (const ms of futureSlots) {
    if (ms >= nowMs) return ms;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

export const evaluateCompliance = (input: EvaluateInput): ComplianceEvaluation => {
  const { schedule, windowStartIso, nowIso } = input;
  const windowStartMs = Date.parse(windowStartIso);
  const nowMs = Date.parse(nowIso);

  if (Number.isNaN(windowStartMs)) throw new Error(`Invalid windowStartIso: ${windowStartIso}`);
  if (Number.isNaN(nowMs)) throw new Error(`Invalid nowIso: ${nowIso}`);

  // Past + currently-pending slots only — anything strictly after
  // (now + on_time) is purely "future" and surfaces via nextDueAtIso.
  const pastUpperMs = nowMs + COMPLIANCE_ON_TIME_WINDOW_MINUTES * MS_PER_MIN;
  const slotMsList = expandSlots(schedule, windowStartMs, pastUpperMs);

  // Filter + sort readings once. Drop readings that can't possibly
  // match any slot (outside the [-on_time, +late] band of the
  // window) and readings of a different check type.
  const matchableFrom = windowStartMs - COMPLIANCE_ON_TIME_WINDOW_MINUTES * MS_PER_MIN;
  const matchableTo = pastUpperMs + COMPLIANCE_LATE_WINDOW_MINUTES * MS_PER_MIN;

  const matchable: ReadingForCompliance[] = [];
  for (const r of input.readings) {
    if (r.checkType !== schedule.checkType) continue;
    const ms = Date.parse(r.measuredAtIso);
    if (Number.isNaN(ms)) continue;
    if (ms < matchableFrom || ms > matchableTo) continue;
    matchable.push(r);
  }
  matchable.sort((a, b) => Date.parse(a.measuredAtIso) - Date.parse(b.measuredAtIso));

  const claimed = new Set<number>();
  const slots: ExpectedSlotEval[] = [];
  let onTimeCount = 0;
  let lateCount = 0;
  let missedCount = 0;
  let pendingCount = 0;

  for (const slotMs of slotMsList) {
    const match = matchReadingToSlot(slotMs, matchable, claimed);

    if (match !== null) {
      claimed.add(match.readingIdx);
      const status =
        Math.abs(match.minutesLate) <= COMPLIANCE_ON_TIME_WINDOW_MINUTES ? "on_time" : "late";
      const slot: ExpectedSlotEval = {
        expectedAtIso: new Date(slotMs).toISOString(),
        status,
        matchedReadingIso: match.reading.measuredAtIso,
        minutesLate: roundToOneDecimal(match.minutesLate),
        // Only set matchedReadingId when the source reading carried
        // one — keeps the field absent rather than `undefined` so it
        // round-trips cleanly through JSON.
        ...(match.reading.id !== undefined ? { matchedReadingId: match.reading.id } : {}),
      };
      slots.push(slot);
      if (status === "on_time") onTimeCount++;
      else lateCount++;
      continue;
    }

    // No reading matched. If the late window has fully elapsed by
    // `nowMs`, the slot is missed; otherwise it's still pending.
    const slotMissedDeadlineMs = slotMs + COMPLIANCE_MISSED_AFTER_MINUTES * MS_PER_MIN;
    const status = nowMs > slotMissedDeadlineMs ? "missed" : "pending";
    slots.push({
      expectedAtIso: new Date(slotMs).toISOString(),
      status,
    });
    if (status === "missed") missedCount++;
    else pendingCount++;
  }

  const nextDueMs = findNextDueMs(schedule, nowMs);

  return {
    scheduleId: schedule.id,
    slots,
    nextDueAtIso: nextDueMs === null ? null : new Date(nextDueMs).toISOString(),
    onTimeCount,
    lateCount,
    missedCount,
    pendingCount,
  };
};

const roundToOneDecimal = (n: number): number => Math.round(n * 10) / 10;

// `compliance-internals` is exported separately so the test file can
// reach the helpers without re-implementing them. Not part of the
// public domain-logic surface; consumers should depend on
// `evaluateCompliance` only.
export const _internals = {
  expandSlots,
  matchReadingToSlot,
  findNextDueMs,
  MS_PER_DAY,
  NEXT_DUE_LOOKAHEAD_DAYS,
};
