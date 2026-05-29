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

  // Each trigger source has its own flag so ops can roll them out
  // independently (CLAUDE.md Phase 4 §D'.2 / phase4.md). All three
  // are off by default; flipping `sos_enabled` alone does NOT
  // re-enable critical-bypass auto-escalation or guardian-initiated
  // remote pull. Patient-manual ships first because it's the only
  // path with explicit consent (long-press + 3s countdown).
  if (params.input.source === "critical_bypass_escalation") {
    const enabled = await getFlag<boolean>("sos_source_critical_bypass_enabled", false);
    if (!enabled) {
      throw new DomainError(
        "SOS_DISABLED",
        "SOS auto-escalation from critical bypass is not enabled.",
      );
    }
  } else if (params.input.source === "guardian_initiated") {
    const enabled = await getFlag<boolean>("sos_source_guardian_initiated_enabled", false);
    if (!enabled) {
      throw new DomainError("SOS_DISABLED", "Guardian-initiated SOS is not enabled.");
    }
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

/** Patient's emergency contacts, sorted by priority. Used by the
 *  mobile active-SOS screen to render "Call {primary} now" instead
 *  of the generic dialer button. */
export const listEmergencyContacts = async (
  userId: string,
): Promise<
  {
    id: string;
    name: string;
    phone: string;
    relationship: string;
    priority: number;
    isGuardian: boolean;
  }[]
> => {
  const rows = await prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    relationship: c.relationship,
    priority: c.priority,
    isGuardian: c.isGuardian,
  }));
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

/**
 * Phase 4 §D'.2 — guardian-initiated SOS. A guardian on an accepted
 * `FamilyLink` triggers SOS on behalf of a linked patient. Gated by
 * `sos_source_guardian_initiated_enabled` (default false). The mobile
 * guardian app calls this when the guardian's "panic for patient"
 * button is pressed — useful when the guardian is alerted out-of-band
 * (phone call from a neighbour, etc.).
 */
export const triggerGuardianInitiatedSOS = async (params: {
  guardianId: string;
  patientId: string;
  clientUuid: string;
  requestId?: string;
}): Promise<SOSEventDto> => {
  const link = await prisma.familyLink.findUnique({
    where: { patientId_guardianId: { patientId: params.patientId, guardianId: params.guardianId } },
  });
  if (link?.status !== "accepted") {
    throw new DomainError("FAMILY_NO_ACCESS", "no accepted family link with this patient");
  }
  return await triggerSOS({
    userId: params.patientId,
    input: { clientUuid: params.clientUuid, source: "guardian_initiated" },
    ...(params.requestId !== undefined ? { requestId: params.requestId } : {}),
  });
};

/**
 * Server-side auto-trigger for `critical_bypass_escalation`. Invoked
 * from the delayed `escalateCriticalBypassToSos` job 5 minutes after
 * a critical-bypass dispatch when no contact responded.
 *
 * Skips silently when:
 *   - `sos_enabled=false` (the global kill switch)
 *   - `sos_source_critical_bypass_enabled=false` (the per-source flag)
 *   - the patient already has an active SOS (no double-trigger)
 *
 * Mints a deterministic clientUuid per (userId, readingId) so the
 * delayed job retrying does not produce a second SOSEvent.
 */
export const autoTriggerSOSFromCriticalBypass = async (params: {
  userId: string;
  readingId: string;
  requestId?: string;
}): Promise<SOSEventDto | null> => {
  const sosEnabled = await getFlag<boolean>("sos_enabled", false);
  if (!sosEnabled) return null;
  const sourceEnabled = await getFlag<boolean>("sos_source_critical_bypass_enabled", false);
  if (!sourceEnabled) return null;

  // Skip if the patient already has a live SOS chain for any reason.
  const active = await prisma.sOSEvent.findFirst({
    where: { userId: params.userId, resolvedAt: null, cancelledAt: null },
    select: { id: true },
  });
  if (active) {
    logger.info(
      { userId: params.userId, readingId: params.readingId, activeId: active.id },
      "auto SOS skipped — active chain already exists",
    );
    return null;
  }

  // Deterministic UUID v5 keyed on (userId, readingId) so retries
  // of the delayed job collapse to a single SOSEvent. We use a
  // synthetic v5 implementation via SHA-256 to avoid the
  // `@types/uuid` dependency drift.
  const ns = `critical-bypass:${params.userId}:${params.readingId}`;
  const hash = await import("node:crypto").then((c) =>
    c.createHash("sha256").update(ns).digest("hex"),
  );
  // Build a v4-shaped UUID from the first 32 hex chars. Not a true
  // v5 but deterministic, which is the property we need.
  const clientUuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

  return await triggerSOS({
    userId: params.userId,
    input: { clientUuid, source: "critical_bypass_escalation" },
    ...(params.requestId !== undefined ? { requestId: params.requestId } : {}),
  });
};
