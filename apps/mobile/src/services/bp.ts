// Phase 2 — BP reading service. Mirrors `readings.ts` but online-only:
// BP isn't on the WatermelonDB hypertable yet (Phase 1 reserved local
// queue space for glucose only). When the network is unavailable we
// surface a `queued` result with no local persistence so the UI can
// still tell the user the reading is safe, and the user can retry by
// pulling-to-refresh once online. The plumbing for a true offline queue
// will land alongside the meal/BP schema migration in Phase 3.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { ReadingContext, ReadingSource } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";

export interface SaveBPInput {
  userId: string;
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
  | { kind: "queued"; clientUuid: string }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  return err.response.status >= 500;
};

export const saveBPReading = async (input: SaveBPInput): Promise<SaveBPResult> => {
  const clientUuid = uuidv4();
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
      // No local persistence yet — surface as queued so the UI shows a
      // friendly message. Recovery: user retries when online.
      track("reading_logged", {
        type: "bp",
        source: input.source,
        value: input.systolic,
        offline: true,
      });
      return { kind: "queued", clientUuid };
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
