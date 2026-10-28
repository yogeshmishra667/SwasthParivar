import type { Q as QType } from "@nozbe/watermelondb";
import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { captureError } from "@/services/sentry";
import { getDatabase } from "@/db/database";
import type { GlucoseReadingModel } from "@/db/models/GlucoseReading";
import { useSyncStore } from "@/stores/sync.store";

/**
 * Reading service — single entry point for saving glucose readings.
 *
 * Flow (CLAUDE.md "logging ALWAYS works"):
 *   1. POST /readings/glucose.
 *   2. On 2xx: return server response. If WatermelonDB is available,
 *      mirror the synced row locally so dashboard reads still work
 *      offline next time.
 *   3. On an answer that says nothing about the reading itself — network
 *      failure, 5xx, an expired session (401), a timeout (408) or the
 *      per-minute limiter (429) — persist to WatermelonDB with
 *      `synced_at = null`; return a `queued` result so the UI can show
 *      "Saved locally — sync hone par update hoga".
 *   4. On any other 4xx (validation, conflict, the daily cap): bubble up
 *      to the caller; do NOT queue — the server has refused it.
 *
 * Queue drain (`drainPendingReadings`) replays unsynced rows, critical
 * values first then `measured_at` order, and marks `synced_at` on success.
 * It deletes a row only when the server refuses it for good (invalid, or a
 * newer version is stored), and never a critical one — see
 * `classifyDrainFailure` (audit P9). Triggered on app boot, NetInfo
 * connect, and a 60s defensive interval — see `useSyncDrain`.
 */

import { isCriticalGlucose, type GlucoseReadingType } from "@swasth/shared-types";

export interface SaveReadingInput {
  userId: string;
  valueMgDl: number;
  readingType: GlucoseReadingType;
  context: "normal" | "festive";
  notes?: string;
  source: "manual" | "voice" | "device";
  measuredAtIso: string;
}

export interface ServerSaveResponse {
  success: boolean;
  data: {
    reading: { id: string };
    streak: { currentStreakDays: number; milestoneReached: number | null };
    feedback: { tone: string; messageKey: string; params: Record<string, unknown> };
    critical: { isCritical: boolean; direction?: "low" | "high" };
  };
}

export type SaveReadingResult =
  | {
      kind: "synced";
      readingId: string;
      streak: { currentStreakDays: number; milestoneReached: number | null };
      feedback: ServerSaveResponse["data"]["feedback"];
      critical: ServerSaveResponse["data"]["critical"];
    }
  | { kind: "queued"; clientUuid: string }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const TABLE = "glucose_readings";

const recordPayload = (
  input: SaveReadingInput,
  clientUuid: string,
): {
  clientUuid: string;
  valueMgDl: number;
  readingType: GlucoseReadingType;
  context: "normal" | "festive";
  notes?: string;
  source: SaveReadingInput["source"];
  measuredAt: string;
  version: number;
  targetUserId: string;
} => ({
  clientUuid,
  valueMgDl: input.valueMgDl,
  readingType: input.readingType,
  context: input.context,
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  source: input.source,
  measuredAt: input.measuredAtIso,
  version: 1,
  // Server uses targetUserId for the shared-phone profile switcher.
  // The server verifies it's a household member of the auth user.
  targetUserId: input.userId,
});

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

// The server counts the daily cap per profile per UTC day, and the drain
// sends every profile's rows on a shared phone.
const capKey = (row: GlucoseReadingModel): string =>
  `${row.userId}:${new Date(row.measuredAt).toISOString().slice(0, 10)}`;

// Rows already reported as held this app session. A held row is retried
// on every drain (60s), so report it once, not once a minute.
const reportedHolds = new Set<string>();

const writeLocalReading = async (
  input: SaveReadingInput,
  clientUuid: string,
  syncedAt: number | null,
): Promise<void> => {
  const db = getDatabase();
  if (!db) return; // local-DB unavailable; queue is a no-op in this runtime
  const collection = db.collections.get<GlucoseReadingModel>(TABLE);
  await db.write(async () => {
    await collection.create((row) => {
      row.clientUuid = clientUuid;
      row.userId = input.userId;
      row.valueMgDl = input.valueMgDl;
      row.readingType = input.readingType;
      row.context = input.context;
      if (input.notes !== undefined) row.notes = input.notes;
      row.source = input.source;
      row.measuredAt = new Date(input.measuredAtIso).getTime();
      row.streakCreditedTo = input.measuredAtIso.slice(0, 10);
      row.version = 1;
      if (syncedAt !== null) row.syncedAt = syncedAt;
    });
  });
};

/**
 * Save a glucose reading. Attempts the API first; on network failure or
 * 5xx, persists to WatermelonDB for the drain loop to retry.
 *
 * Returns a discriminated union — callers MUST handle all three kinds.
 * UI text for the `queued` and `rejected` cases is the caller's
 * responsibility (different screens have different copy).
 */
export const saveGlucoseReading = async (input: SaveReadingInput): Promise<SaveReadingResult> => {
  const clientUuid = uuidv4();
  const payload = recordPayload(input, clientUuid);

  try {
    const res = await api.post<ServerSaveResponse>("/readings/glucose", payload);
    track("reading_logged", {
      type: input.readingType,
      source: input.source,
      value: input.valueMgDl,
      offline: false,
    });

    // Mirror the synced row locally so the dashboard still works offline.
    // Failure here doesn't undo the API success — log and move on.
    try {
      await writeLocalReading(input, clientUuid, Date.now());
    } catch (mirrorErr) {
      logError("saveGlucoseReading.mirror", mirrorErr);
    }

    return {
      kind: "synced",
      readingId: res.data.reading.id,
      streak: res.data.streak,
      feedback: res.data.feedback,
      critical: res.data.critical,
    };
  } catch (err) {
    if (classifyDrainFailure(err) !== "abort") {
      // The server refused it (validation, conflict, daily cap): stop,
      // surface to caller. Don't queue.
      const axiosErr = isAxiosError(err) ? err : null;
      const status = axiosErr?.response?.status ?? 0;
      const data = axiosErr?.response?.data as
        | { error?: { code?: string; message?: string } }
        | undefined;
      track("reading_logged", {
        type: input.readingType,
        source: input.source,
        value: input.valueMgDl,
        offline: false,
        rejected: true,
        status,
      });
      return {
        kind: "rejected",
        status,
        code: data?.error?.code ?? null,
        message: data?.error?.message ?? "Reading rejected by server",
      };
    }

    // Network, 5xx, 401, 408 or the per-minute 429 — persist for the drain loop.
    try {
      await writeLocalReading(input, clientUuid, null);
      // Update sync-store pending count for the UI badge.
      const next = useSyncStore.getState().pendingCount + 1;
      useSyncStore.setState({ pendingCount: next });
      track("reading_logged", {
        type: input.readingType,
        source: input.source,
        value: input.valueMgDl,
        offline: true,
      });
      track("fail_safe_triggered", { scenario: "reading_save_offline" });
      return { kind: "queued", clientUuid };
    } catch (queueErr) {
      logError("saveGlucoseReading.queue", queueErr);
      // No local DB AND no network — best we can do is reject loudly.
      return {
        kind: "rejected",
        status: 0,
        code: "OFFLINE_QUEUE_UNAVAILABLE",
        message: "Sync queue unavailable",
      };
    }
  }
};

/**
 * Drain pending (un-synced) glucose readings from WatermelonDB to the
 * server. Called from `useSyncDrain` on boot, NetInfo connect, and a
 * 60s defensive interval. Safe to invoke concurrently — guarded by the
 * sync store phase.
 */
export const drainPendingReadings = async (): Promise<{
  pushed: number;
  failed: number;
  held: number;
}> => {
  const db = getDatabase();
  if (!db) return { pushed: 0, failed: 0, held: 0 };

  const { phase, setPhase, setPendingCount } = useSyncStore.getState();
  if (phase === "draining") return { pushed: 0, failed: 0, held: 0 };

  setPhase("draining");

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Q } = require("@nozbe/watermelondb") as { Q: typeof QType };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const collection = db.collections.get<GlucoseReadingModel>(TABLE);

  try {
    const pending = await collection
      .query(Q.where("synced_at", null), Q.sortBy("measured_at", Q.asc))
      .fetch();
    // Critical readings first: the server's critical chain (family push,
    // SMS, IVR) runs on arrival, so they must not wait behind a backlog or
    // a per-minute 429 that the rows ahead of them used up.
    const ordered = [
      ...pending.filter((r) => isCriticalGlucose(r.valueMgDl)),
      ...pending.filter((r) => !isCriticalGlucose(r.valueMgDl)),
    ];

    let pushed = 0;
    let failed = 0;
    let held = 0;
    // Profile-days the daily cap has already answered for: the rest of that
    // profile's rows for that day are held without spending a request each.
    const cappedProfileDays = new Set<string>();

    for (const row of ordered) {
      const critical = isCriticalGlucose(row.valueMgDl);
      if (!critical && cappedProfileDays.has(capKey(row))) {
        held++;
        continue;
      }
      const body = {
        clientUuid: row.clientUuid,
        valueMgDl: row.valueMgDl,
        readingType: row.readingType,
        context: row.context ?? "normal",
        // Unset optional columns read back as null, not undefined. Sending
        // `"notes": null` was a 400, and the drain then deleted the reading.
        ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
        source: row.source,
        measuredAt: new Date(row.measuredAt).toISOString(),
        version: row.version,
        // Preserve the profile the reading was originally logged for.
        targetUserId: row.userId,
      };
      try {
        await api.post<ServerSaveResponse>("/readings/glucose", body);
        await db.write(async () => {
          await row.update((r) => {
            r.syncedAt = Date.now();
          });
        });
        pushed++;
      } catch (err) {
        const outcome = classifyDrainFailure(err);
        const status = isAxiosError(err) ? (err.response?.status ?? 0) : 0;
        if (outcome === "drop" && !critical) {
          // Refused for good (invalid, or a newer version is stored). A
          // deleted medical reading goes to Sentry, not just analytics.
          logError("drainPendingReadings.drop", err);
          captureError(err, { where: "drainPendingReadings.drop", status });
          await db.write(async () => {
            await row.markAsDeleted();
          });
          track("fail_safe_triggered", { scenario: `sync_drop_${status}` });
          failed++;
          continue;
        }
        if (outcome !== "abort") {
          // Keep it pending and move on, so one row can't block the queue.
          // A critical reading is never deleted, even when refused. The
          // daily cap is expected — reported, but not as an error.
          if (status === 429) cappedProfileDays.add(capKey(row));
          if (!reportedHolds.has(row.clientUuid)) {
            reportedHolds.add(row.clientUuid);
            if (status !== 429) logError("drainPendingReadings.hold", err);
            track("fail_safe_triggered", { scenario: `sync_hold_${status}` });
          }
          held++;
          continue;
        }
        // Network, 5xx, 401, 408 or the per-minute 429 — abort the drain;
        // the next trigger will retry.
        logError("drainPendingReadings", err);
        setPhase("error", err instanceof Error ? err.message : "drain_aborted");
        const remaining = await collection.query(Q.where("synced_at", null)).fetchCount();
        setPendingCount(remaining);
        return { pushed, failed, held };
      }
    }

    const remaining = await collection.query(Q.where("synced_at", null)).fetchCount();
    setPendingCount(remaining);
    setPhase(remaining === 0 && (pushed > 0 || pending.length === 0) ? "synced" : "idle");

    return { pushed, failed, held };
  } catch (err) {
    // A local failure (the query, a local write) must not leave the phase
    // on "draining": every later drain would return at once and nothing,
    // critical readings included, would ever leave the phone.
    setPhase("error", err instanceof Error ? err.message : "drain_failed");
    throw err;
  }
};

/** Used on app boot to seed the sync-store badge with reality. */
export const refreshPendingCount = async (): Promise<number> => {
  const db = getDatabase();
  if (!db) return 0;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Q } = require("@nozbe/watermelondb") as { Q: typeof QType };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const collection = db.collections.get<GlucoseReadingModel>(TABLE);
  const count = await collection.query(Q.where("synced_at", null)).fetchCount();
  useSyncStore.getState().setPendingCount(count);
  return count;
};
