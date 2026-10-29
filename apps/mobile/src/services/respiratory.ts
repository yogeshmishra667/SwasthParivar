// Phase 4 Feature E — Respiratory log mobile service. Online-first; a log
// the server didn't answer for (network, 5xx, expired session) is stored in
// the offline queue (`services/pending-writes.ts`, audit P8) and sent later.
// Before P8 it returned `queued` without storing anything.
//
// Server kill-switch `respiratory_logging_enabled` returns 503 with code
// `RESPIRATORY_DISABLED` — surfaced as a typed `rejected` result. Not
// queued: the feature is off, not the network.

import { isAxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import { classifyRespiratoryReading } from "@swasth/domain-logic";
import type { ReadingSource, SymptomSeverity } from "@swasth/shared-types";

import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { enqueuePendingWrite } from "@/services/pending-writes";
import { classifyDrainFailure } from "@/services/drain-policy";
import { withSentAt } from "@/services/sent-at";

export interface SaveRespiratoryInput {
  /** Profile to log against (shared phone — see CLAUDE.md "Shared Phone Profile Switcher"). */
  userId: string;
  /** Stable per entered log, so a retry is an idempotent replay. New when omitted. */
  clientUuid?: string;
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
  /** Stored on the phone; sent when the server answers again. */
  | { kind: "queued"; clientUuid: string }
  /** No answer from the server AND it couldn't be stored on the phone. */
  | { kind: "network_failed" }
  | { kind: "rejected"; status: number; code: string | null; message: string };

const errorCode = (err: unknown): string | null =>
  isAxiosError(err)
    ? ((err.response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null)
    : null;

export const saveRespiratoryLog = async (
  input: SaveRespiratoryInput,
): Promise<SaveRespiratoryResult> => {
  const clientUuid = input.clientUuid ?? uuidv4();
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
  };

  try {
    const res = await api.post<ServerRespiratoryResponse>(
      "/readings/respiratory",
      withSentAt(payload),
    );
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
    if (errorCode(err) !== "RESPIRATORY_DISABLED" && classifyDrainFailure(err) === "abort") {
      // Without the personal-best baseline only severe symptoms (or a
      // supplied baseline) classify as critical here.
      const critical =
        classifyRespiratoryReading({
          peakFlow: input.peakFlow ?? null,
          baselinePeakFlow: input.baselinePeakFlow ?? null,
          inhalerUsed: input.inhalerUsed ?? false,
          symptomSeverity: input.symptomSeverity ?? "none",
        }).severity === "critical_bypass";
      const stored = await enqueuePendingWrite({
        kind: "respiratory",
        payload,
        critical,
        takenAtIso: input.measuredAtIso,
      });
      track("reading_logged", {
        type: "respiratory",
        source: input.source,
        value: input.peakFlow ?? 0,
        offline: true,
        stored,
      });
      return stored ? { kind: "queued", clientUuid } : { kind: "network_failed" };
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
