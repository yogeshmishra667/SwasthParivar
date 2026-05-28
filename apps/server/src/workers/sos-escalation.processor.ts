// Phase 4 Feature D' — SOS escalation tick processor.
//
// One job = one tick of the state machine. The processor:
//   1. loads the SOSEvent row + emergency contacts,
//   2. computes the next stage via the pure state machine,
//   3. on a transition, persists the new stage and dispatches the
//      stage's contact attempts (Exotel/Twilio IVR + MSG91 SMS),
//   4. re-schedules itself unless the row reached a terminal stage.
//
// Side effects are gated by `sos_test_mode` (Redis flag, default
// true) so a stuck flag-flip can never wake a real call chain by
// accident. The IVR vendor wrappers honour the same flag.
//
// This is the SCAFFOLD landing — the real dispatch wiring (push,
// SMS, contact attempt logging) lands in Phase 4 Week 14 once
// `sos_test_mode=false` is approved for the internal cohort. For
// now the processor logs every transition and updates the
// `contacts_notified` audit array with `{stage, channel:"log_only",
// at}` rows so ops can replay a test-mode run end-to-end.

import type { Job, Queue } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  isSOSChainActive,
  nextSOSStage,
  selectContactForStage,
  type SOSContact,
  type SOSStage,
} from "@swasth/domain-logic";
import { createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/flags.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";

export interface SOSEscalationJob {
  /** SOSEvent.id — primary key of the row to step. */
  readonly sosEventId: string;
  /** Forwarded from the originating HTTP request so the dispatch log
   * line joins the request log under the same requestId. */
  readonly requestId?: string;
}

/** Snapshot stage at which the dispatcher last attempted contacts.
 * Tracked separately from the state-machine `escalationStage` so we
 * can detect "the chain JUST moved into this stage, fire its
 * contacts" vs "this stage already dispatched, just wait". */
interface DispatchLogEntry {
  readonly contactId: string;
  readonly stage: SOSStage;
  readonly channel: "log_only" | "ivr" | "sms" | "push";
  readonly at: string;
  readonly status: "queued" | "delivered" | "skipped_test_mode" | "failed";
  readonly reason?: string;
}

const SOS_TICK_INTERVAL_MS = 30_000;

// Lazy queue handle. We create it on first use rather than at module
// import so the test harness (which boots its own queue connection)
// can swap it out without bringing two Redis connections up at once.
let _sosQueue: Queue<SOSEscalationJob> | null = null;
const sosQueue = (): Queue<SOSEscalationJob> => {
  _sosQueue ??= createQueue<SOSEscalationJob>(QUEUE_NAMES.SOS_ESCALATION);
  return _sosQueue;
};

const isContactsNotifiedArray = (v: unknown): v is DispatchLogEntry[] => Array.isArray(v);

const contactsForStage = (
  stage: SOSStage,
  rawContacts: SOSContact[],
  alreadyAttempted: string[],
): SOSContact[] => {
  const out: SOSContact[] = [];
  const attempted = [...alreadyAttempted];
  while (true) {
    const next = selectContactForStage({
      stage,
      contacts: rawContacts,
      alreadyAttempted: attempted,
    });
    if (!next) break;
    out.push(next);
    attempted.push(next.id);
  }
  return out;
};

export const processSOSEscalation = async (job: Job<SOSEscalationJob>): Promise<void> => {
  const { sosEventId, requestId } = job.data;
  const log = logger.child({
    queue: QUEUE_NAMES.SOS_ESCALATION,
    jobId: job.id ?? undefined,
    sosEventId,
    ...(requestId ? { requestId } : {}),
  });

  // Kill-switch: a flipped `sos_enabled=false` mid-flight stops the
  // chain dead. The row stays in its current stage (no rollback —
  // someone may genuinely have been reached) and the worker won't
  // re-schedule itself.
  const sosEnabled = await getFlag<boolean>("sos_enabled", false);
  if (!sosEnabled) {
    log.warn("sos_enabled=false — skipping tick, NOT rescheduling");
    return;
  }

  const event = await prisma.sOSEvent.findUnique({
    where: { id: sosEventId },
    include: { user: { select: { name: true, emergencyContacts: true } } },
  });

  if (!event) {
    log.error("SOSEvent not found — dropping tick");
    return;
  }

  if (!isSOSChainActive(event.escalationStage)) {
    log.info({ stage: event.escalationStage }, "chain terminal — no further ticks");
    return;
  }

  // `sos_test_mode` snapshotted at create time on `event.testMode`.
  // We never re-read the flag here: a flag flipped mid-escalation
  // must NOT retroactively change whether a row makes real calls.
  const testMode = event.testMode;

  const elapsedSeconds = Math.floor((Date.now() - event.triggeredAt.getTime()) / 1000);

  const transition = nextSOSStage({
    currentStage: event.escalationStage,
    elapsedSecondsSinceTrigger: elapsedSeconds,
    // Mobile + cancel/resolve endpoints are the only writers; they
    // set `cancelledAt` / `resolvedAt` directly. We translate row
    // state into state-machine input here.
    patientCancelled: event.cancelledBy === "patient",
    externallyCancelled: event.cancelledBy !== null && event.cancelledBy !== "patient",
    resolved: event.resolvedAt !== null,
    // anyContactAnsweredCall is read off the dispatch log. Phase 4
    // Week 14 wires the vendor webhooks that flip this; for now it's
    // always false (the IVR stubs never claim a connect).
    anyContactAnsweredCall: false,
  });

  if (transition.changed) {
    log.warn(
      {
        from: event.escalationStage,
        to: transition.nextStage,
        reason: transition.reason,
        elapsedSeconds,
        testMode,
      },
      "SOS stage transition",
    );

    // Dispatch this stage's contacts. In test mode we record a
    // `log_only` row per contact so the dispatch log shows the WHO
    // for the audit trail without firing a real call.
    const contacts: SOSContact[] = event.user.emergencyContacts.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      priority: c.priority,
      isGuardian: c.isGuardian,
    }));
    const attemptedIds = (
      isContactsNotifiedArray(event.contactsNotified) ? event.contactsNotified : []
    ).map((e) => e.contactId);
    const stageContacts = contactsForStage(transition.nextStage, contacts, attemptedIds);

    const newEntries: DispatchLogEntry[] = stageContacts.map((c) => ({
      contactId: c.id,
      stage: transition.nextStage,
      channel: testMode ? "log_only" : "ivr",
      at: new Date().toISOString(),
      status: testMode ? "skipped_test_mode" : "queued",
      ...(testMode ? { reason: "sos_test_mode=true" } : {}),
    }));

    const existingLog: DispatchLogEntry[] = isContactsNotifiedArray(event.contactsNotified)
      ? event.contactsNotified
      : [];

    await prisma.sOSEvent.update({
      where: { id: sosEventId },
      data: {
        escalationStage: transition.nextStage,
        contactsNotified: [...existingLog, ...newEntries] as unknown as Prisma.InputJsonValue,
      },
    });

    captureAnalyticsEvent("sos_stage_transition", event.userId, {
      sos_event_id: sosEventId,
      from: event.escalationStage,
      to: transition.nextStage,
      reason: transition.reason,
      elapsed_seconds: elapsedSeconds,
      test_mode: testMode,
      contacts_in_stage: stageContacts.length,
    });
  }

  // Reschedule if the chain is still active. We always reschedule
  // (not just on transitions) so the worker catches the next
  // timeout deterministically — the cron tick interval is finer
  // than every stage threshold (60s, 300s, 600s).
  if (isSOSChainActive(transition.nextStage)) {
    await sosQueue().add(
      QUEUE_NAMES.SOS_ESCALATION,
      { sosEventId, ...(requestId !== undefined ? { requestId } : {}) },
      // BullMQ rejects `:` inside custom job ids → use `-`.
      { delay: SOS_TICK_INTERVAL_MS, jobId: `${sosEventId}-${Date.now()}` },
    );
  }
};
