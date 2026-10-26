// BP reading service. Online-only: BP has no local (WatermelonDB) queue
// yet. A network failure is therefore reported honestly as "not saved"
// (never "saved locally") and the caller keeps the same `clientUuid` so a
// retry is an idempotent replay on the server, never a duplicate. A
// CRITICAL BP is also re-sent in the background until it lands, so the
// server-side family alert (push + SMS) still goes out once the network
// returns (P4 review C1). It is persisted, so an app kill or restart
// doesn't drop it: `resumePendingCriticalBP` picks it up again (W1).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAxiosError } from "axios";
import { isCriticalBP, type ReadingContext, type ReadingSource } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";

export interface SaveBPInput {
  userId: string;
  /** Stable per reading: every retry of the same reading reuses it. */
  clientUuid: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  context?: ReadingContext;
  notes?: string;
  source: ReadingSource;
  measuredAtIso: string;
}

export interface ServerBPResponse {
  success: boolean;
  data: {
    reading: { id: string; clientUuid: string; version: number };
  };
}

export type SaveBPResult =
  | { kind: "synced"; readingId: string }
  /** Not saved — no network / server error. `retrying`: critical BP being re-sent in the background. */
  | { kind: "network_failed"; retrying: boolean }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  return err.response.status >= 500;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface BPPayload {
  clientUuid: string;
  [field: string]: unknown;
}

// Critical BPs not yet on the server, persisted across app restarts.
const PENDING_KEY = "swasth.pendingCriticalBP.v1";
// Past this age a re-send is dropped: the family alert would be a day late.
const PENDING_MAX_AGE_MS = 24 * 60 * 60_000;

interface PendingCriticalBP {
  payload: BPPayload;
  queuedAt: string;
}

const readPending = async (): Promise<PendingCriticalBP[]> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingCriticalBP[]) : [];
  } catch {
    return [];
  }
};

const writePending = async (items: readonly PendingCriticalBP[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch (err) {
    logError("pendingCriticalBP", err);
  }
};

const persistPending = async (payload: BPPayload): Promise<void> => {
  const items = await readPending();
  if (items.some((i) => i.payload.clientUuid === payload.clientUuid)) return;
  await writePending([...items, { payload, queuedAt: new Date().toISOString() }]);
};

const clearPending = async (clientUuid: string): Promise<void> => {
  const items = await readPending();
  await writePending(items.filter((i) => i.payload.clientUuid !== clientUuid));
};

// Background re-send for a critical BP that failed to reach the server.
const CRITICAL_RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;
const retryingInBackground = new Set<string>();

const resendCriticalInBackground = (
  payload: BPPayload,
  backoffMs: readonly number[] = CRITICAL_RETRY_BACKOFF_MS,
): void => {
  const { clientUuid } = payload;
  if (retryingInBackground.has(clientUuid)) return;
  retryingInBackground.add(clientUuid);
  void (async () => {
    try {
      for (const [attempt, delayMs] of backoffMs.entries()) {
        await sleep(delayMs);
        try {
          await api.post("/readings/bp", payload);
          track("critical_bp_background_sync", { attempt: attempt + 1, delivered: true });
          await clearPending(clientUuid);
          return;
        } catch (err) {
          if (!isNetworkOrServerError(err)) {
            // The server answered (e.g. a validation reject): nothing to retry.
            await clearPending(clientUuid);
            return;
          }
        }
      }
      // Still pending: the next resume (reconnect, app start, 60s sync tick)
      // tries again.
      track("critical_bp_background_sync", { attempt: backoffMs.length, delivered: false });
    } finally {
      retryingInBackground.delete(clientUuid);
    }
  })();
};

/**
 * Re-sends every persisted critical BP not yet on the server. Called by
 * the sync drain on app start, on reconnect and every 60s; a reading
 * already being re-sent is skipped.
 */
export const resumePendingCriticalBP = async (): Promise<void> => {
  const items = await readPending();
  const now = Date.now();
  const fresh = items.filter((i) => now - Date.parse(i.queuedAt) < PENDING_MAX_AGE_MS);
  if (fresh.length !== items.length) {
    track("critical_bp_background_sync_expired", { count: items.length - fresh.length });
    await writePending(fresh);
  }
  for (const item of fresh)
    resendCriticalInBackground(item.payload, [0, ...CRITICAL_RETRY_BACKOFF_MS]);
};

export const saveBPReading = async (input: SaveBPInput): Promise<SaveBPResult> => {
  const clientUuid = input.clientUuid;
  const critical = isCriticalBP(input.systolic, input.diastolic);
  const payload: BPPayload = {
    clientUuid,
    systolic: input.systolic,
    diastolic: input.diastolic,
    ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
    context: input.context ?? "normal",
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    source: input.source,
    measuredAt: input.measuredAtIso,
    version: 1,
    targetUserId: input.userId,
  };

  try {
    const res = await api.post<ServerBPResponse>("/readings/bp", payload);
    track("reading_logged", {
      type: "bp",
      source: input.source,
      value: input.systolic,
      offline: false,
    });
    // A manual retry that lands supersedes any background re-send.
    if (critical) await clearPending(clientUuid);
    return { kind: "synced", readingId: res.data.reading.id };
  } catch (err) {
    if (isNetworkOrServerError(err)) {
      if (critical) {
        await persistPending(payload);
        resendCriticalInBackground(payload);
      }
      return { kind: "network_failed", retrying: critical };
    }

    if (isAxiosError(err) && err.response) {
      if (critical) await clearPending(clientUuid);
      const data = err.response.data as { error?: { code?: string; message?: string } } | undefined;
      return {
        kind: "rejected",
        status: err.response.status,
        code: data?.error?.code ?? null,
        message: data?.error?.message ?? "Save failed",
      };
    }

    logError("saveBPReading", err);
    return { kind: "rejected", status: 0, code: null, message: "Unknown error" };
  }
};

export interface BPListItem {
  id: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  measuredAt: string;
  context: ReadingContext;
}

export const listBP = async (params: {
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: BPListItem[]; cursor: string | null; hasMore: boolean }> => {
  const res = await api.get<{
    success: boolean;
    data: { data: BPListItem[]; cursor: string | null; hasMore: boolean };
  }>("/readings/bp", { params });
  return res.data;
};
