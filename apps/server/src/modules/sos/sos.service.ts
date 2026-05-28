// Phase 4 Feature D' — SOS service.
//
// Three responsibilities only:
//   1. Enforce kill-switches (`sos_enabled` + flag-gated trigger
//      sources).
//   2. Persist the SOSEvent row with `testMode` snapshotted from the
//      `sos_test_mode` flag (immutable for the row's lifetime).
//   3. Enqueue the escalation tick.
//
// Everything else — vendor calls, state transitions, contact
// resolution — happens in the worker. This keeps the request path
// fast and the side-effect surface easily testable.

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { getFlag } from "../../shared/flags/flags.js";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import { capture as captureAnalyticsEvent } from "../../shared/analytics/posthog.js";
import { logger } from "../../shared/logger.js";
import type { SOSEscalationJob } from "../../workers/sos-escalation.processor.js";
import type { SOSEventDto, SOSTriggerInput } from "./sos.types.js";

const sosQueue = createQueue<SOSEscalationJob>(QUEUE_NAMES.SOS_ESCALATION);

/** First-tick delay. Slightly above 0 so the worker has time to
 * settle and the response returns before the first transition fires
 * — important for the mobile UX (the user sees "SOS active" before
 * the escalation begins). */
const FIRST_TICK_DELAY_MS = 5_000;

const toDto = (row: {
  id: string;
  userId: string;
  triggeredAt: Date;
  triggerSource: SOSEventDto["triggerSource"];
  escalationStage: SOSEventDto["escalationStage"];
  testMode: boolean;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  falseAlarm: boolean;
}): SOSEventDto => ({
  id: row.id,
  userId: row.userId,
  triggeredAt: row.triggeredAt.toISOString(),
  triggerSource: row.triggerSource,
  escalationStage: row.escalationStage,
  testMode: row.testMode,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  cancelledBy: row.cancelledBy,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  resolvedBy: row.resolvedBy,
  falseAlarm: row.falseAlarm,
});

const enqueueTick = async (sosEventId: string, requestId?: string): Promise<void> => {
  await sosQueue.add(
    QUEUE_NAMES.SOS_ESCALATION,
    { sosEventId, ...(requestId !== undefined ? { requestId } : {}) },
    {
      delay: FIRST_TICK_DELAY_MS,
      // Distinct jobId per tick — the processor re-adds itself with
      // a fresh suffix so the queue doesn't reject a duplicate.
      // BullMQ rejects `:` inside custom job ids → use `-`.
      jobId: `${sosEventId}-initial`,
    },
  );
};

export interface TriggerSOSParams {
  userId: string;
  input: SOSTriggerInput;
  requestId?: string;
}

export const triggerSOS = async (params: TriggerSOSParams): Promise<SOSEventDto> => {
  const sosEnabled = await getFlag<boolean>("sos_enabled", false);
  if (!sosEnabled) {
    throw new DomainError(
      "SOS_DISABLED",
      "SOS is currently unavailable. Call emergency services directly.",
    );
  }

  // Phase 4 Week 13 ships `patient_manual` only. The two other
  // sources are reserved enum values and stay rejected here until
  // their dedicated rollout (§D'.2 — critical-bypass auto-escalation
  // + guardian-initiated remote pull).
  if (params.input.source !== "patient_manual") {
    throw new DomainError(
      "VALIDATION_ERROR",
      `SOS trigger source not yet enabled: ${params.input.source}`,
    );
  }

  // Idempotency check — same `clientUuid` from the mobile retry
  // collapses to the same row. Look first to keep the happy-path
  // dispatch on the original event (no double-tick enqueue).
  const existing = await prisma.sOSEvent.findUnique({
    where: { clientUuid: params.input.clientUuid },
  });
  if (existing) {
    logger.info(
      { sosEventId: existing.id, userId: params.userId, requestId: params.requestId },
      "SOS trigger idempotent replay",
    );
    return toDto(existing);
  }

  // Snapshot `sos_test_mode` at row-create time. Flipping the flag
  // mid-escalation MUST NOT retroactively change whether THIS row
  // makes real calls (CLAUDE.md "SOS Test-Mode Default" — every
  // event carries its own decision).
  const testMode = await getFlag<boolean>("sos_test_mode", true);

  try {
    const row = await prisma.sOSEvent.create({
      data: {
        id: randomUUID(),
        clientUuid: params.input.clientUuid,
        userId: params.userId,
        triggerSource: params.input.source,
        locationLat: params.input.locationLat ?? null,
        locationLng: params.input.locationLng ?? null,
        locationAccuracyM: params.input.locationAccuracyM ?? null,
        lastReadings: (params.input.lastReadings ?? {}) as Prisma.InputJsonValue,
        testMode,
      },
    });

    await enqueueTick(row.id, params.requestId);

    captureAnalyticsEvent("sos_triggered", params.userId, {
      sos_event_id: row.id,
      source: params.input.source,
      has_location: params.input.locationLat !== undefined,
      location_accuracy_m: params.input.locationAccuracyM ?? null,
      test_mode: testMode,
    });

    return toDto(row);
  } catch (err) {
    // Race: two parallel triggers with the same clientUuid. The
    // unique constraint on (client_uuid) bounces the second; we
    // re-fetch and return the winner's row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.sOSEvent.findUnique({
        where: { clientUuid: params.input.clientUuid },
      });
      if (winner) return toDto(winner);
    }
    throw err;
  }
};

export interface CancelSOSParams {
  userId: string;
  sosEventId: string;
  by: "patient" | "guardian";
}

export const cancelSOS = async (params: CancelSOSParams): Promise<SOSEventDto> => {
  const row = await prisma.sOSEvent.findUnique({ where: { id: params.sosEventId } });
  if (!row) throw new DomainError("SOS_NOT_FOUND", "SOS event not found");
  if (row.userId !== params.userId) {
    // Phase 4 §D'.2 will widen this to "any household member or
    // accepted guardian"; Phase 4 Week 13 keeps it strict.
    throw new DomainError("SOS_FORBIDDEN", "not your SOS event");
  }
  if (row.cancelledAt !== null || row.resolvedAt !== null) {
    // Idempotent — return the terminal state without rewriting.
    return toDto(row);
  }

  const updated = await prisma.sOSEvent.update({
    where: { id: params.sosEventId },
    data: { cancelledAt: new Date(), cancelledBy: params.by },
  });

  captureAnalyticsEvent("sos_cancelled", params.userId, {
    sos_event_id: row.id,
    stage: row.escalationStage,
    by: params.by,
    elapsed_seconds: Math.floor((Date.now() - row.triggeredAt.getTime()) / 1000),
  });

  return toDto(updated);
};

export interface ResolveSOSParams {
  userId: string;
  sosEventId: string;
  by: "patient" | "guardian" | "admin";
  falseAlarm?: boolean;
}

export const resolveSOS = async (params: ResolveSOSParams): Promise<SOSEventDto> => {
  const row = await prisma.sOSEvent.findUnique({ where: { id: params.sosEventId } });
  if (!row) throw new DomainError("SOS_NOT_FOUND", "SOS event not found");
  if (row.userId !== params.userId) {
    throw new DomainError("SOS_FORBIDDEN", "not your SOS event");
  }
  if (row.resolvedAt !== null) return toDto(row); // idempotent

  const updated = await prisma.sOSEvent.update({
    where: { id: params.sosEventId },
    data: {
      resolvedAt: new Date(),
      resolvedBy: params.by,
      ...(params.falseAlarm !== undefined ? { falseAlarm: params.falseAlarm } : {}),
    },
  });

  captureAnalyticsEvent("sos_resolved", params.userId, {
    sos_event_id: row.id,
    by: params.by,
    elapsed_seconds: Math.floor((Date.now() - row.triggeredAt.getTime()) / 1000),
    false_alarm: params.falseAlarm ?? false,
  });

  return toDto(updated);
};

/** Most-recent active (non-terminal) SOS for this user. Mobile uses
 * this on app open to re-render the fullscreen alert if the app was
 * backgrounded during a live escalation. */
export const getActiveSOS = async (userId: string): Promise<SOSEventDto | null> => {
  const row = await prisma.sOSEvent.findFirst({
    where: { userId, resolvedAt: null, cancelledAt: null },
    orderBy: { triggeredAt: "desc" },
  });
  return row ? toDto(row) : null;
};
