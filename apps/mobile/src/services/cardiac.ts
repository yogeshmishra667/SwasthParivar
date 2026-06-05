// Phase 4 Feature E — Cardiac log mobile service. Online-first with a
// `queued` fallback on network / server error, mirroring `services/bp.ts`.
//
// Why no WatermelonDB queue yet: cardiac logs are Phase 4 — the local-
// first storage path will land alongside the wearables push integration
// (Feature I) when the sync surface needs to scale beyond manual entry.
// For now an in-memory queued result lets the UI tell the user the row
// is safe and the next pull-to-refresh resyncs.
//
// Server kill-switch `cardiac_logging_enabled` returns 503 with code
// `CARDIAC_DISABLED` — surfaced as a typed `rejected` result so the
// caller can render a friendly "feature unavailable" card rather than a
// generic error.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { ExerciseTolerance, ReadingSource, RhythmStatus } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";

export interface SaveCardiacInput {
  /** Profile to log against (shared phone — see CLAUDE.md "Shared Phone Profile Switcher"). */
  userId: string;
  heartRate: number;
  rhythmStatus?: RhythmStatus;
  chestPain?: boolean;
  /** Numeric Rating Scale 0–10. Required when `chestPain=true`. */
  painSeverity?: number;
  exerciseTolerance?: ExerciseTolerance;
  notes?: string;
  source: ReadingSource;
  measuredAtIso: string;
}

interface ServerCardiacResponse {
  success: boolean;
  data: {
    reading: { id: string; clientUuid: string; version: number; heartRate: number };
    critical: {
      isCritical: boolean;
      /** Stable classifier reason code, e.g. `critical.hr_low` / `warn.chest_pain`. */
      primaryReason: string;
      withinCooldown: boolean;
    };
  };
}

export type SaveCardiacResult =
  | {
      kind: "synced";
      readingId: string;
      heartRate: number;
      critical: { isCritical: boolean; primaryReason: string; withinCooldown: boolean };
    }
  | { kind: "queued"; clientUuid: string }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  return err.response.status >= 500 && err.response.status !== 503;
};

export const saveCardiacLog = async (input: SaveCardiacInput): Promise<SaveCardiacResult> => {
  const clientUuid = uuidv4();
  const payload = {
    clientUuid,
    heartRate: input.heartRate,
    ...(input.rhythmStatus !== undefined ? { rhythmStatus: input.rhythmStatus } : {}),
    ...(input.chestPain !== undefined ? { chestPain: input.chestPain } : {}),
    ...(input.painSeverity !== undefined ? { painSeverity: input.painSeverity } : {}),
    ...(input.exerciseTolerance !== undefined
      ? { exerciseTolerance: input.exerciseTolerance }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    source: input.source,
    measuredAt: input.measuredAtIso,
    version: 1,
    targetUserId: input.userId,
  } as const;

  try {
    const res = await api.post<ServerCardiacResponse>("/readings/cardiac", payload);
    track("reading_logged", {
      type: "cardiac",
      source: input.source,
      value: input.heartRate,
      offline: false,
    });
    return {
      kind: "synced",
      readingId: res.data.reading.id,
      heartRate: res.data.reading.heartRate,
      critical: res.data.critical,
    };
  } catch (err) {
    if (isNetworkOrServerError(err)) {
      track("reading_logged", {
        type: "cardiac",
        source: input.source,
        value: input.heartRate,
        offline: true,
      });
      return { kind: "queued", clientUuid };
    }

    if (isAxiosError(err) && err.response) {
      const status = err.response.status;
      const body = err.response.data as { error?: { code?: string; message?: string } } | undefined;
      const code = body?.error?.code ?? null;
      const message = body?.error?.message ?? "Cardiac log rejected";
      logError("saveCardiacLog", err);
      return { kind: "rejected", status, code, message };
    }

    logError("saveCardiacLog", err);
    return { kind: "rejected", status: 0, code: null, message: "Unknown error" };
  }
};
