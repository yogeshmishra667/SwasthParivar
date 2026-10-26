// BP reading service. Online-only: BP has no local (WatermelonDB) queue
// yet. A network failure is therefore reported honestly as "not saved"
// (never "saved locally") and the caller keeps the same `clientUuid` so a
// retry is an idempotent replay on the server, never a duplicate. A
// CRITICAL BP is also re-sent in the background until it lands, so the
// server-side family alert (push + SMS) still goes out once the network
// returns (P4 review C1).

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

// Background re-send for a critical BP that failed to reach the server.
const CRITICAL_RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;
const retryingInBackground = new Set<string>();

const resendCriticalInBackground = (clientUuid: string, payload: object): void => {
  if (retryingInBackground.has(clientUuid)) return;
  retryingInBackground.add(clientUuid);
  void (async () => {
    try {
      for (const [attempt, backoffMs] of CRITICAL_RETRY_BACKOFF_MS.entries()) {
        await sleep(backoffMs);
        try {
          await api.post("/readings/bp", payload);
          track("critical_bp_background_sync", { attempt: attempt + 1, delivered: true });
          return;
        } catch (err) {
          if (!isNetworkOrServerError(err)) return; // the server answered — nothing to retry
        }
      }
      track("critical_bp_background_sync", {
        attempt: CRITICAL_RETRY_BACKOFF_MS.length,
        delivered: false,
      });
    } finally {
      retryingInBackground.delete(clientUuid);
    }
  })();
};

export const saveBPReading = async (input: SaveBPInput): Promise<SaveBPResult> => {
  const clientUuid = input.clientUuid;
  const payload = {
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
  } as const;

  try {
    const res = await api.post<ServerBPResponse>("/readings/bp", payload);
    track("reading_logged", {
      type: "bp",
      source: input.source,
      value: input.systolic,
      offline: false,
    });
    return { kind: "synced", readingId: res.data.reading.id };
  } catch (err) {
    if (isNetworkOrServerError(err)) {
      const critical = isCriticalBP(input.systolic, input.diastolic);
      if (critical) resendCriticalInBackground(clientUuid, payload);
      return { kind: "network_failed", retrying: critical };
    }

    if (isAxiosError(err) && err.response) {
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
