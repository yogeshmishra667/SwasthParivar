import { isAxiosError } from "axios";

// How an offline queue treats a failed send. Shared by the glucose queue
// (`readings.ts`) and the queue for BP, cardiac, respiratory and meal logs
// (`pending-writes.ts`), and by their save paths: a save that gets "abort"
// is stored for the drain, anything else is the server's answer.

// The server refused this row for good: invalid (400) or a newer version
// is already stored (409). Matched by code, not status — a 409 from an
// unrelated constraint race must not delete a reading the server never
// stored.
const DROP_CODES: ReadonlySet<string> = new Set([
  "VALIDATION_ERROR",
  "READING_INVALID_VALUE",
  "READING_STALE_VERSION",
]);
// Answers about the session or the connection, not the row: an expired
// session (401, after the api client's refresh also failed) or a timeout
// (408). Every row behind this one would get the same answer.
const RETRY_LATER_STATUSES: ReadonlySet<number> = new Set([401, 408]);

const errorCode = (data: unknown): string | null =>
  (data as { error?: { code?: string } } | null | undefined)?.error?.code ?? null;

/**
 * What the drain does with a row the server didn't accept (audit P9 —
 * it used to delete the row on ANY 4xx, so a 401 after a long offline
 * spell or a 429 while draining a backlog deleted medical readings):
 *   - `drop`  — the server refused it for good. Delete it.
 *   - `skip`  — keep it, try the next row: the daily cap, which answers
 *               429 with a JSON `RATE_LIMITED` body (only that day is
 *               full), or a 4xx we don't recognise (e.g. 403 for one
 *               profile). Never delete what we don't understand.
 *   - `abort` — keep it and stop; the next trigger retries everything:
 *               network failure, 5xx, 401, 408, and the per-minute 429
 *               (express-rate-limit's plain-text body).
 */
export const classifyDrainFailure = (err: unknown): "drop" | "skip" | "abort" => {
  if (!isAxiosError(err) || !err.response) return "abort"; // unknown or network
  const status = err.response.status;
  const code = errorCode(err.response.data);
  if (status >= 500) return "abort";
  if (code !== null && DROP_CODES.has(code)) return "drop";
  if (status === 429) return code === "RATE_LIMITED" ? "skip" : "abort";
  if (RETRY_LATER_STATUSES.has(status)) return "abort";
  return "skip";
};
