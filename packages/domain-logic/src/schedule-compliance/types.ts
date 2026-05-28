// Phase 2 carry-over — schedule-compliance pure types.
//
// The compliance evaluator is fully pure: given a schedule, a list of
// readings, an evaluation window and a "now" timestamp, it returns
// per-slot verdicts + the next due slot. No DB, no clock, no I/O.
//
// Timezone handling mirrors `streak-engine`: callers pass
// `userTzOffsetMinutes` instead of an IANA name to keep the module
// free of Intl-dependent date math.

/** Which reading surface the schedule expects. Mirrors `HealthCheckType`
 * in Prisma; kept local so domain-logic stays free of Prisma enums. */
export type ScheduleCheckType = "glucose" | "bp" | "cardiac" | "respiratory";

/** How the schedule repeats. Daily honours every entry every day;
 * weekly requires each entry to carry a `dayOfWeek`. */
export type ScheduleFrequency = "daily" | "weekly";

/** Per-slot verdict. `pending` means the slot is in the future OR
 * still inside its grace window — i.e. not yet terminal. */
export type ComplianceStatus = "on_time" | "late" | "missed" | "pending";

/**
 * One slot description inside `HealthCheckSchedule.scheduledTimes`.
 *
 * For `frequency: "daily"` the slot fires every day at `{hour, minute}`
 * (user-local) and `dayOfWeek` is ignored.
 *
 * For `frequency: "weekly"` the slot fires only when the user-local
 * weekday matches `dayOfWeek` (0=Sun..6=Sat). `dayOfWeek` is required
 * on weekly schedules — `evaluateCompliance` throws if missing.
 */
export interface ScheduledSlot {
  readonly hour: number; // 0-23
  readonly minute: number; // 0-59
  readonly dayOfWeek?: number; // 0-6 (Sun..Sat); required for weekly
}

/** Schedule shape the evaluator consumes. The DB row → input mapping
 * lives at the service boundary. */
export interface ScheduleInput {
  readonly id: string;
  readonly checkType: ScheduleCheckType;
  readonly frequency: ScheduleFrequency;
  readonly scheduledTimes: readonly ScheduledSlot[];
  readonly active: boolean;
  /** Minutes east of UTC, signed. IST = 330. */
  readonly userTzOffsetMinutes: number;
}

/** One reading reduced to the fields the matcher uses. */
export interface ReadingForCompliance {
  readonly measuredAtIso: string;
  readonly checkType: ScheduleCheckType;
  /** Optional reading identifier — surfaced in `matchedReadingId` so
   * the persisting worker can store it on `HealthCheckCompliance`. */
  readonly id?: string;
}

/** One evaluated slot in the past window. */
export interface ExpectedSlotEval {
  /** Absolute UTC ISO of the slot. */
  readonly expectedAtIso: string;
  readonly status: ComplianceStatus;
  /** Set when a reading matched the slot inside the late window. */
  readonly matchedReadingId?: string;
  readonly matchedReadingIso?: string;
  /** Minutes by which the matched reading is after the expected time
   * (negative if the reading came before — within the early grace
   * window). Undefined when no reading matched. */
  readonly minutesLate?: number;
}

/** Output of `evaluateCompliance`. */
export interface ComplianceEvaluation {
  readonly scheduleId: string;
  readonly slots: readonly ExpectedSlotEval[];
  /** Next future slot at or after `nowIso` (in `evaluateInput`).
   * `null` when the schedule is inactive or has no scheduled slots. */
  readonly nextDueAtIso: string | null;
  readonly onTimeCount: number;
  readonly lateCount: number;
  readonly missedCount: number;
  readonly pendingCount: number;
}

/** Caller-curated window + now. The evaluator does not call `Date.now()`. */
export interface EvaluateInput {
  readonly schedule: ScheduleInput;
  readonly readings: readonly ReadingForCompliance[];
  /** Inclusive lower bound of the past window. Typical: now - 7d. */
  readonly windowStartIso: string;
  /** Current time. Anchors the on_time/late/missed thresholds for
   * still-pending slots and the next-due lookup. */
  readonly nowIso: string;
}

// ─────────────────────────────────────────────────────────────
// Compliance windows
// ─────────────────────────────────────────────────────────────
//
// CLAUDE.md does not pin numeric windows for slot matching, so these
// constants live here, exported, and the integration tests + UI use
// the same source of truth. The values were picked to mirror the
// medical reality of a fasting-glucose schedule: the patient has up
// to an hour around the slot to be on time, two more hours to be
// late, after which the slot is medically missed and the schedule
// worker would consider firing a guardian reminder.
//
// On-time covers BOTH directions (patient logs slightly early as well
// as late) because elderly patients commonly log before alarm time.

/** Half-width of the on-time bucket in minutes (applied either side
 * of the expected slot). A reading inside `[expected - 60min,
 * expected + 60min]` is on_time. */
export const COMPLIANCE_ON_TIME_WINDOW_MINUTES = 60;

/** Upper bound of the late bucket, measured forward from the
 * expected slot. A reading inside `(expected + on_time, expected +
 * 180min]` is late. */
export const COMPLIANCE_LATE_WINDOW_MINUTES = 180;

/** A slot whose late window has fully elapsed without a matching
 * reading becomes `missed`. Equal to `COMPLIANCE_LATE_WINDOW_MINUTES`
 * — exported separately for callers that may diverge in future. */
export const COMPLIANCE_MISSED_AFTER_MINUTES = COMPLIANCE_LATE_WINDOW_MINUTES;
