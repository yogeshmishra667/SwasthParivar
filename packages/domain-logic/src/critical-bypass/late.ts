// Audit P33 — a critical reading that reaches the server long after it was
// taken (an offline queue drained hours later) must not be handled as a
// current emergency. Paging it as current alarms the family about a reading
// that may be hours old, starts the 30-min cooldown at sync time (so a REAL
// critical reading soon after reaches nobody), re-alerts the patient's own
// phone and schedules the SOS escalation. The family is still told, with
// the time the reading was taken.
//
// The age is measured on the device's own clock when the app reports when
// it sent the reading (`sentAt`): a phone whose clock is hours off then
// still gets the right age, because both times carry the same error. Older
// app builds don't send it, so the server's receive time stands in.
//
// Fail-safe: a time that can't be parsed reads as age 0 — a current
// emergency, never a late one.

export const LATE_CRITICAL_THRESHOLD_MINUTES = 120 as const;

const MS_PER_MIN = 60_000;

export interface ReadingAgeInput {
  /** When the reading was taken (device clock). */
  measuredAtIso: string;
  /** When the device sent it (device clock). Null for older app builds. */
  sentAtIso: string | null;
  /** When the server received it. Used only when `sentAtIso` is null. */
  receivedAtIso: string;
}

/** How old the reading was when it was sent, in ms (negative if from the future). */
export const readingAgeAtSendMs = (input: ReadingAgeInput): number => {
  const measuredMs = Date.parse(input.measuredAtIso);
  const referenceMs = Date.parse(input.sentAtIso ?? input.receivedAtIso);
  if (!Number.isFinite(measuredMs) || !Number.isFinite(referenceMs)) return 0;
  return referenceMs - measuredMs;
};

/** True when the reading is older than the late threshold: alert the family as late, not as current. */
export const isLateCriticalReading = (input: ReadingAgeInput): boolean =>
  readingAgeAtSendMs(input) > LATE_CRITICAL_THRESHOLD_MINUTES * MS_PER_MIN;
