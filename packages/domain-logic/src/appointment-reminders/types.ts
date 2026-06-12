// Phase 4 Feature G.3 — appointment-reminder pure types.
//
// The reminder window calculator is fully pure: given an appointment's
// scheduled time, "now", and which windows have already been sent, it
// returns the windows that are due to fire on this tick. No DB, no
// clock, no I/O — the hourly worker supplies `nowMs` and persists the
// sent-flags.

/** The three reminder lead times per CLAUDE.md "APPOINTMENT_REMINDER:
 * 7d, 1d, 2hr". Ordered coarse → fine. */
export type ReminderWindow = "7d" | "1d" | "2h";

/** Which windows have already fired for an appointment. Mirrors the
 * `reminderSent7d/1d/2h` booleans on `DoctorAppointment`. */
export interface SentReminderWindows {
  readonly "7d": boolean;
  readonly "1d": boolean;
  readonly "2h": boolean;
}

export interface DueWindowsInput {
  /** Appointment time, epoch millis. */
  readonly scheduledAtMs: number;
  /** Current time, epoch millis. The evaluator never calls Date.now(). */
  readonly nowMs: number;
  readonly sent: SentReminderWindows;
}
