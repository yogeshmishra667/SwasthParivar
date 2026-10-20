// Activity aggregation (Phase 4 §E.2 #3, Feature I dashboard).
//
// Pure. Takes a flat list of daily activity rows — possibly several per
// day from different sources (a HealthKit sync AND a manual entry for
// the same date) — and collapses them into ONE authoritative summary
// per day, plus period totals a dashboard widget can show directly.
//
// DEDUP RULE (CLAUDE.md wearable trust model, "manual entry for same
// userId+date wins"): within a day, a MANUAL row always beats a device
// row. This mirrors the server's write-time dedup in
// `activity.service.ts`, but as a pure function it also handles the case
// where a batch backfill hands us both sources at once (e.g. the
// WEARABLE_BACKFILL job merging 30 days of history against manual rows).
//
// This function does NOT sum steps across sources for the same day —
// each row is already a per-source daily total, and two sources
// double-count the same steps. Dedup picks the trusted source; it never
// adds them together.

import type { WearableSourceKind } from "../wearable-trust/index.js";

export interface ActivityLog {
  /** Calendar day, YYYY-MM-DD (the DATE the row belongs to). */
  date: string;
  steps: number;
  distanceMeters: number;
  activeMinutes: number;
  source: WearableSourceKind;
}

export interface DayActivitySummary {
  date: string;
  steps: number;
  distanceMeters: number;
  activeMinutes: number;
  /** The source that won the day after dedup. */
  source: WearableSourceKind;
}

export interface ActivitySummary {
  /** One entry per day, ascending by date. */
  days: DayActivitySummary[];
  totalSteps: number;
  totalDistanceMeters: number;
  totalActiveMinutes: number;
  /** Number of distinct days represented. */
  dayCount: number;
}

// Lower rank wins the day. Manual is authoritative; device sources fall
// back in a fixed order so the pick is deterministic when a user has
// both a phone (HealthKit) and a watch (Google Fit) for the same day and
// no manual entry.
const SOURCE_RANK: Record<WearableSourceKind, number> = {
  manual: 0,
  healthkit: 1,
  googlefit: 2,
};

/**
 * Collapse activity rows into one authoritative summary per day (manual
 * wins), returned ascending by date with period totals. Deterministic:
 * ties within the same source are broken by last-write (later entries in
 * the input override earlier ones).
 */
export const dailyActivitySummary = (logs: readonly ActivityLog[]): ActivitySummary => {
  const winnerByDay = new Map<string, ActivityLog>();

  for (const log of logs) {
    const current = winnerByDay.get(log.date);
    if (current === undefined) {
      winnerByDay.set(log.date, log);
      continue;
    }
    // Replace the current winner when the new row ranks at least as high
    // (lower rank number). Equal rank → last-write-wins (a refreshed row
    // for the same source supersedes the earlier one).
    if (SOURCE_RANK[log.source] <= SOURCE_RANK[current.source]) {
      winnerByDay.set(log.date, log);
    }
  }

  const days: DayActivitySummary[] = [...winnerByDay.values()]
    .map((log) => ({
      date: log.date,
      steps: log.steps,
      distanceMeters: log.distanceMeters,
      activeMinutes: log.activeMinutes,
      source: log.source,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let totalSteps = 0;
  let totalDistanceMeters = 0;
  let totalActiveMinutes = 0;
  for (const d of days) {
    totalSteps += d.steps;
    totalDistanceMeters += d.distanceMeters;
    totalActiveMinutes += d.activeMinutes;
  }

  return {
    days,
    totalSteps,
    totalDistanceMeters,
    totalActiveMinutes,
    dayCount: days.length,
  };
};
