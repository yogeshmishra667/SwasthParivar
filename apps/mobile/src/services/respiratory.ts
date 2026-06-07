// Phase 4 Feature E — Respiratory log mobile service. Online-first with
// a `queued` fallback, mirroring `services/bp.ts` + `services/cardiac.ts`.
// WatermelonDB queue is deferred to Feature I alongside wearables —
// manual respiratory entry is rare enough that an in-memory queued
// result + next-pull resync is acceptable for the initial cohort.
//
// Server kill-switch `respiratory_logging_enabled` returns 503 with code
// `RESPIRATORY_DISABLED` — surfaced as a typed `rejected` result.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { ReadingSource, SymptomSeverity } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";

export interface SaveRespiratoryInput {
  /** Profile to log against (shared phone — see CLAUDE.md "Shared Phone Profile Switcher"). */
  userId: string;
  peakFlow?: number;
  baselinePeakFlow?: number;
  inhalerUsed?: boolean;
  inhalerType?: string;
  puffs?: number;
  triggerNote?: string;
  symptomSeverity?: SymptomSeverity;
  notes?: string;
  source: ReadingSource;
  measuredAtIso: string;
}

interface ServerRespiratoryResponse {
  success: boolean;
  data: {
    reading: {
      id: string;
      clientUuid: string;
      version: number;
      peakFlow: number | null;
      baselinePeakFlow: number | null;
    };
    critical: {
      isCritical: boolean;
      primaryReason: string;
      withinCooldown: boolean;
    };
  };
}

export type SaveRespiratoryResult =
  | {
      kind: "synced";
      readingId: string;
      peakFlow: number | null;
      baselinePeakFlow: number | null;
      critical: { isCritical: boolean; primaryReason: string; withinCooldown: boolean };
    }
  | { kind: "queued"; clientUuid: string }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const isNetworkOrServerError = (err: unknown): boolean => {
  if (!isAxiosError(err)) return true;
  if (!err.response) return true;
  // 503 with a typed kill-switch code is a server-issued "feature off" —
  // do NOT bucket as a transient network error or the UI will pretend
  // the row was queued safely.
  return err.response.status >= 500 && err.response.status !== 503;
};

export const saveRespiratoryLog = async (
  input: SaveRespiratoryInput,
): Promise<SaveRespiratoryResult> => {
  const clientUuid = uuidv4();
  const payload = {
    clientUuid,
    ...(input.peakFlow !== undefined ? { peakFlow: input.peakFlow } : {}),
    ...(input.baselinePeakFlow !== undefined ? { baselinePeakFlow: input.baselinePeakFlow } : {}),
    ...(input.inhalerUsed !== undefined ? { inhalerUsed: input.inhalerUsed } : {}),
    ...(input.inhalerType !== undefined ? { inhalerType: input.inhalerType } : {}),
    ...(input.puffs !== undefined ? { puffs: input.puffs } : {}),
    ...(input.triggerNote !== undefined ? { triggerNote: input.triggerNote } : {}),
    ...(input.symptomSeverity !== undefined ? { symptomSeverity: input.symptomSeverity } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    source: input.source,
    measuredAt: input.measuredAtIso,
    version: 1,
    targetUserId: input.userId,
  } as const;

  try {
    const res = await api.post<ServerRespiratoryResponse>("/readings/respiratory", payload);
    track("reading_logged", {
      type: "respiratory",
      source: input.source,
      value: input.peakFlow ?? 0,
      offline: false,
    });
    return {
      kind: "synced",
      readingId: res.data.reading.id,
      peakFlow: res.data.reading.peakFlow,
      baselinePeakFlow: res.data.reading.baselinePeakFlow,
      critical: res.data.critical,
    };
  } catch (err) {
    if (isNetworkOrServerError(err)) {
      track("reading_logged", {
        type: "respiratory",
        source: input.source,
        value: input.peakFlow ?? 0,
        offline: true,
      });
      return { kind: "queued", clientUuid };
    }

    if (isAxiosError(err) && err.response) {
      const status = err.response.status;
      const body = err.response.data as { error?: { code?: string; message?: string } } | undefined;
      const code = body?.error?.code ?? null;
      const message = body?.error?.message ?? "Respiratory log rejected";
      logError("saveRespiratoryLog", err);
      return { kind: "rejected", status, code, message };
    }

    logError("saveRespiratoryLog", err);
    return { kind: "rejected", status: 0, code: null, message: "Unknown error" };
  }
};
