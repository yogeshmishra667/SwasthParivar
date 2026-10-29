// Audit P33 — a critical reading that reaches the server long after it was
// taken (an offline queue drained hours later) must not be handled as a
// current emergency. Paging it as current alarms the family about a reading
// that may be hours old, starts the 30-min cooldown at sync time (so a REAL
// critical reading soon after reaches nobody), re-alerts the patient's own
// phone and schedules the SOS escalation.
//
// Two separate decisions, both failing toward a live alert:
//
//   - `late` — the family gets a late notice instead of the live chain.
//     Only when the app said when it sent the reading (`sentAt`) AND both
//     clocks put the reading over the threshold: the device's (sentAt −
//     measuredAt, which a phone clock hours off can't distort) and the
//     server's (received − measuredAt). Without `sentAt` (older app builds,
//     endpoints that don't carry it) a reading is never late: a phone whose
//     clock is hours behind would otherwise turn a current emergency into a
//     late notice.
//   - `startsCooldown` — false when the best age estimate (the device's when
//     known, else the server's) is over the threshold. A reading that old
//     must not silence the next critical one, even when it still gets the
//     live chain. Skipping a cooldown can only cause an extra alert.
//
// A time that can't be parsed reads as age 0: current, live, cooldown on.

export const LATE_CRITICAL_THRESHOLD_MINUTES = 120 as const;

const MS_PER_MIN = 60_000;
const THRESHOLD_MS = LATE_CRITICAL_THRESHOLD_MINUTES * MS_PER_MIN;

export interface ReadingAgeInput {
  /** When the reading was taken (device clock). */
  measuredAtIso: string;
  /** When the device sent it (device clock). Null when the request didn't say. */
  sentAtIso: string | null;
  /** When the server received it. */
  receivedAtIso: string;
}

export interface CriticalReadingTiming {
  /** Send the family a late notice instead of the live chain. */
  readonly late: boolean;
  /** Start the per-category cooldown (glucose: a `critical_warn` marker). */
  readonly startsCooldown: boolean;
  /** Age on the device's clock when it was sent (null without `sentAt`). */
  readonly deviceAgeMs: number | null;
}

const ageMs = (fromIso: string, toIso: string): number => {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return to - from;
};

/** How old the reading was when it was sent, by the device's clock (negative if from the future). */
export const readingAgeAtSendMs = (input: ReadingAgeInput): number | null =>
  input.sentAtIso === null ? null : ageMs(input.measuredAtIso, input.sentAtIso);

export const criticalReadingTiming = (input: ReadingAgeInput): CriticalReadingTiming => {
  const deviceAgeMs = readingAgeAtSendMs(input);
  const serverAgeMs = ageMs(input.measuredAtIso, input.receivedAtIso);
  const late = deviceAgeMs !== null && deviceAgeMs > THRESHOLD_MS && serverAgeMs > THRESHOLD_MS;
  const bestAgeMs = deviceAgeMs ?? serverAgeMs;
  return { late, startsCooldown: bestAgeMs <= THRESHOLD_MS, deviceAgeMs };
};

/** True when the family gets a late notice rather than the live chain. */
export const isLateCriticalReading = (input: ReadingAgeInput): boolean =>
  criticalReadingTiming(input).late;
