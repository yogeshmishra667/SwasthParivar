// Phase 4 Feature E — Cardiac log mobile service. Online-first; a log the
// server didn't answer for (network, 5xx, expired session) is stored in the
// offline queue (`services/pending-writes.ts`, audit P8) and sent later.
// Before P8 it returned `queued` without storing anything.
//
// Server kill-switch `cardiac_logging_enabled` returns 503 with code
// `CARDIAC_DISABLED` — surfaced as a typed `rejected` result so the
// caller can render a friendly "feature unavailable" card rather than a
// generic error. Not queued: the feature is off, not the network.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import { classifyCardiacReading } from "@swasth/domain-logic";
import type { ExerciseTolerance, ReadingSource, RhythmStatus } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { enqueuePendingWrite } from "@/services/pending-writes";
import { classifyDrainFailure } from "@/services/drain-policy";

export interface SaveCardiacInput {
  /** Profile to log against (shared phone — see CLAUDE.md "Shared Phone Profile Switcher"). */
  userId: string;
  /** Stable per entered log, so a retry is an idempotent replay. New when omitted. */
  clientUuid?: string;
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
  /** Stored on the phone; sent when the server answers again. */
  | { kind: "queued"; clientUuid: string }
  /** No answer from the server AND it couldn't be stored on the phone. */
  | { kind: "network_failed" }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const errorCode = (err: unknown): string | null =>
  isAxiosError(err)
    ? ((err.response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null)
    : null;

export const saveCardiacLog = async (input: SaveCardiacInput): Promise<SaveCardiacResult> => {
  const clientUuid = input.clientUuid ?? uuidv4();
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
  };

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
    if (errorCode(err) !== "CARDIAC_DISABLED" && classifyDrainFailure(err) === "abort") {
      const critical =
        classifyCardiacReading({
          heartRateBpm: input.heartRate,
          rhythmStatus: input.rhythmStatus ?? "unknown",
          chestPain: input.chestPain ?? false,
          painSeverity: input.painSeverity ?? null,
          exerciseTolerance: input.exerciseTolerance ?? "normal",
        }).severity === "critical_bypass";
      const stored = await enqueuePendingWrite({
        kind: "cardiac",
        payload,
        critical,
        takenAtIso: input.measuredAtIso,
      });
      track("reading_logged", {
        type: "cardiac",
        source: input.source,
        value: input.heartRate,
        offline: true,
        stored,
      });
      return stored ? { kind: "queued", clientUuid } : { kind: "network_failed" };
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
