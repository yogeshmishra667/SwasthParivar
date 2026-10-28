// BP reading service. Online-first; a BP the server didn't answer for
// (network, 5xx, expired session, the per-minute limit) is stored in the
// offline queue (`services/pending-writes.ts`, audit P8) and sent later,
// critical ones first.
//
// Fallback when the queue can't store it (no local DB, or the write
// failed): the failure is reported honestly as "not saved" and the caller
// keeps the same `clientUuid`, so a retry is an idempotent replay on the
// server, never a duplicate. A CRITICAL BP is then still re-sent in the
// background until it lands, so the server-side family alert (push + SMS)
// goes out once the network returns (P4 review C1). It is persisted, so an
// app kill or restart doesn't drop it: `resumePendingCriticalBP` picks it
// up again (W1).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAxiosError } from "axios";
import { isCriticalBP, type ReadingContext, type ReadingSource } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { enqueuePendingWrite } from "@/services/pending-writes";
import { classifyDrainFailure } from "@/services/drain-policy";

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
  /** Stored on the phone; sent when the server answers again. */
  | { kind: "queued"; clientUuid: string }
  /**
   * No answer from the server AND it couldn't be stored on the phone.
   * `retrying`: a critical BP is being re-sent in the background.
   */
  | { kind: "network_failed"; retrying: boolean }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  return err.response.status >= 500;
};

// Answers after which the server may still accept the same reading later:
// an expired session (401), a timeout (408) or a rate limit (429).
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([401, 408, 429]);

/** True when a critical BP must stay pending: the server hasn't accepted or refused it for good. */
const isRetryable = (err: unknown): boolean =>
  isNetworkOrServerError(err) ||
  (isAxiosError(err) && err.response !== undefined && RETRYABLE_STATUSES.has(err.response.status));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface BPPayload {
  clientUuid: string;
  targetUserId: string;
  [field: string]: unknown;
}

// Critical BPs not yet on the server, persisted across app restarts.
const PENDING_KEY = "swasth.pendingCriticalBP.v1";
// Past this age a re-send is dropped: the server would page the family
// "BP very high" for a reading hours old.
const PENDING_MAX_AGE_MS = 2 * 60 * 60_000;

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

// Every read-modify-write of the queue runs one at a time, so a clear
// for one reading can't drop another reading's concurrent persist.
let pendingQueueTail: Promise<unknown> = Promise.resolve();
const updatePending = (
  update: (items: PendingCriticalBP[]) => PendingCriticalBP[],
): Promise<PendingCriticalBP[]> => {
  const run = pendingQueueTail.then(async () => {
    const next = update(await readPending());
    await writePending(next);
    return next;
  });
  pendingQueueTail = run.catch(() => undefined);
  return run;
};

const persistPending = async (payload: BPPayload): Promise<void> => {
  await updatePending((items) =>
    items.some((i) => i.payload.clientUuid === payload.clientUuid)
      ? items
      : [...items, { payload, queuedAt: new Date().toISOString() }],
  );
};

const clearPending = async (clientUuid: string): Promise<void> => {
  await updatePending((items) => items.filter((i) => i.payload.clientUuid !== clientUuid));
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
          if (!isRetryable(err)) {
            // The server refused it for good (e.g. validation), or a 409:
            // a newer version is already stored. Nothing to retry.
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
  let expired = 0;
  const fresh = await updatePending((items) => {
    const now = Date.now();
    const kept = items.filter((i) => now - Date.parse(i.queuedAt) < PENDING_MAX_AGE_MS);
    expired = items.length - kept.length;
    return kept;
  });
  if (expired > 0) track("critical_bp_background_sync_expired", { count: expired });
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
    if (classifyDrainFailure(err) === "abort") {
      const stored = await enqueuePendingWrite({
        kind: "bp",
        payload,
        critical,
        takenAtIso: input.measuredAtIso,
      });
      if (stored) {
        // The queue owns it now; drop any fallback copy of the same reading.
        if (critical) await clearPending(clientUuid);
        track("reading_logged", {
          type: "bp",
          source: input.source,
          value: input.systolic,
          offline: true,
        });
        return { kind: "queued", clientUuid };
      }
    }
    // Not stored. A critical BP is also kept when the session expired or
    // the server throttled it (review W2): the family alert depends on it
    // landing.
    if (isNetworkOrServerError(err) || (critical && isRetryable(err))) {
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
