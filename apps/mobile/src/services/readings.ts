import type { Q as QType } from "@nozbe/watermelondb";
import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
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
 *   3. On 4xx (validation, auth, conflict): bubble up to caller; do
 *      NOT queue — bad input won't fix itself by retrying.
 *   4. On network failure or 5xx: persist to WatermelonDB with
 *      `synced_at = null`; return a `queued` result so the UI can
 *      show "Saved locally — sync hone par update hoga".
 *
 * Queue drain (`drainPendingReadings`) replays unsynced rows in
 * `measured_at` order, marks `synced_at` on success, and drops rows
 * the server rejects (4xx). Triggered on app boot, NetInfo connect,
 * and a 60s defensive interval — see `useSyncDrain`.
 */

import type { GlucoseReadingType } from "@swasth/shared-types";

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

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true; // unknown error — treat as transient
  if (!err.response) return true; // network failure (no response)
  return err.response.status >= 500;
};

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
export const saveGlucoseReading = async (
  input: SaveReadingInput,
): Promise<SaveReadingResult> => {
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
    if (!isNetworkOrServerError(err)) {
      // 4xx: stop, surface to caller. Don't queue.
      const axiosErr = isAxiosError(err) ? err : null;
      const status = axiosErr?.response?.status ?? 0;
      const data = axiosErr?.response?.data as { error?: { code?: string; message?: string } } | undefined;
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

    // Network or 5xx — persist for the drain loop.
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
export const drainPendingReadings = async (): Promise<{ pushed: number; failed: number }> => {
  const db = getDatabase();
  if (!db) return { pushed: 0, failed: 0 };

  const { phase, setPhase, setPendingCount } = useSyncStore.getState();
  if (phase === "draining") return { pushed: 0, failed: 0 };

  setPhase("draining");

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { Q } = require("@nozbe/watermelondb") as { Q: typeof QType };
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const collection = db.collections.get<GlucoseReadingModel>(TABLE);
  const pending = await collection
    .query(Q.where("synced_at", null), Q.sortBy("measured_at", Q.asc))
    .fetch();

  let pushed = 0;
  let failed = 0;

  for (const row of pending) {
    const body = {
      clientUuid: row.clientUuid,
      valueMgDl: row.valueMgDl,
      readingType: row.readingType,
      context: row.context ?? "normal",
      ...(row.notes !== undefined ? { notes: row.notes } : {}),
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
      if (isAxiosError(err) && err.response && err.response.status >= 400 && err.response.status < 500) {
        // Server rejected the row (validation, auth, version conflict).
        // Drop it locally — retrying won't fix bad data, and the server
        // already has it for 409 (idempotent on clientUuid).
        const status = err.response.status;
        await db.write(async () => {
          await row.markAsDeleted();
        });
        track("fail_safe_triggered", { scenario: `sync_drop_${status}` });
        failed++;
        continue;
      }
      // Network or 5xx — abort the drain; the next trigger will retry.
      logError("drainPendingReadings", err);
      setPhase("error", err instanceof Error ? err.message : "drain_aborted");
      const remaining = await collection.query(Q.where("synced_at", null)).fetchCount();
      setPendingCount(remaining);
      return { pushed, failed };
    }
  }

  const remaining = await collection.query(Q.where("synced_at", null)).fetchCount();
  setPendingCount(remaining);
  setPhase(remaining === 0 && (pushed > 0 || pending.length === 0) ? "synced" : "idle");

  return { pushed, failed };
};

/** Used on app boot to seed the sync-store badge with reality. */
export const refreshPendingCount = async (): Promise<number> => {
  const db = getDatabase();
  if (!db) return 0;
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { Q } = require("@nozbe/watermelondb") as { Q: typeof QType };
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const collection = db.collections.get<GlucoseReadingModel>(TABLE);
  const count = await collection.query(Q.where("synced_at", null)).fetchCount();
  useSyncStore.getState().setPendingCount(count);
  return count;
};
