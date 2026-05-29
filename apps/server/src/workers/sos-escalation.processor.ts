// Phase 4 Feature D' — SOS escalation tick processor.
//
// One job = one tick of the state machine. The processor:
//   1. loads the SOSEvent row + emergency contacts,
//   2. computes the next stage via the pure state machine,
//   3. on a transition, persists the new stage and dispatches the
//      stage's contact attempts (Exotel/Twilio IVR + MSG91 SMS) +
//      a patient-household push,
//   4. re-schedules itself unless the row reached a terminal stage.
//
// Side effects in real mode (`event.testMode === false`):
//   - push to the patient's household primary device (so the
//     elderly user sees the fullscreen on the shared phone), plus
//   - SMS via MSG91 to the stage's contacts, plus
//   - IVR via Exotel (+91*) / Twilio (international fallback).
//
// `event.testMode` is snapshotted at row create time — flipping the
// `sos_test_mode` flag mid-escalation MUST NOT retroactively promote
// a log-only row to a real-call row (CLAUDE.md "SOS Test-Mode
// Default"). The flag is only read by the trigger endpoint.
//
// `anyContactAnsweredCall` is read off the per-contact dispatch log;
// the vendor status webhooks (POST /sos/webhooks/{exotel,twilio}/status)
// flip `status: "answered"` on the corresponding entry.

import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { Job, Queue } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  buildSOSMessage,
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
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";
import { sendSmsBatch } from "../shared/notifications/msg91-sms.js";
import { resolveHouseholdDelivery } from "../shared/notifications/household-delivery.js";
import { placeExotelIvrCall } from "../shared/calls/exotel-voice.js";
import { placeTwilioIvrCall } from "../shared/calls/twilio-voice.js";
import { pickIvrVendor } from "../shared/calls/types.js";
import type { IvrCallResult } from "../shared/calls/types.js";

export interface SOSEscalationJob {
  /** SOSEvent.id — primary key of the row to step. */
  readonly sosEventId: string;
  /** Forwarded from the originating HTTP request so the dispatch log
   * line joins the request log under the same requestId. */
  readonly requestId?: string;
}

/** Per-contact dispatch log entry persisted onto SOSEvent.contactsNotified. */
interface DispatchLogEntry {
  readonly contactId: string;
  readonly stage: SOSStage;
  /** Which channel attempted this contact. A single contact can have
   * multiple entries across channels and stages — the array is
   * append-only and ops replays it by `(contactId, stage, channel)`. */
  readonly channel: "log_only" | "ivr" | "sms" | "push";
  readonly at: string;
  /** Lifecycle:
   *  - `queued`              → request accepted by vendor
   *  - `delivered`           → push/SMS provider accepted for delivery
   *  - `answered`            → vendor webhook reports the contact picked
   *                            up the IVR call (sets `anyContactAnsweredCall=true`
   *                            on the next state-machine tick)
   *  - `skipped_test_mode`   → event.testMode=true at create time
   *  - `failed`              → vendor returned non-2xx / unreachable */
  readonly status: "queued" | "delivered" | "answered" | "skipped_test_mode" | "failed";
  readonly reason?: string;
  /** Vendor-side correlation id (Exotel Call SID, Twilio SID). The
   * webhook joins back to the dispatch entry via this value. */
  readonly vendorCallId?: string;
  /** Pure-function correlation id we mint per attempt. Surfaced in
   * the IVR CustomField so the webhook can find this entry without
   * needing the vendor id. */
  readonly correlationId?: string;
}

const SOS_TICK_INTERVAL_MS = 30_000;

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

const detectAnyAnswered = (entries: DispatchLogEntry[]): boolean =>
  entries.some((e) => e.status === "answered");

// ── IVR dispatch — vendor routing + Sentry safety net ────────────

const dispatchIvr = async (params: {
  contact: SOSContact;
  script: string;
  correlationId: string;
  testMode: boolean;
  ivrEnabled: boolean;
  sosEventId: string;
}): Promise<IvrCallResult> => {
  const vendor = pickIvrVendor(params.contact.phone);
  const request = {
    to: params.contact.phone,
    script: params.script,
    correlationId: params.correlationId,
  };

  const result =
    vendor === "exotel"
      ? await placeExotelIvrCall(request, { testMode: params.testMode })
      : await placeTwilioIvrCall(request, { testMode: params.testMode });

  // SOS_IVR_NO_VENDOR safety net. When ops enable IVR but the routed
  // vendor is unconfigured we page Sentry — the safety chain must
  // never fully fail silently. The dispatcher continues with push +
  // SMS so the guardian still has SOME signal (phase4.md §D'.1).
  if (params.ivrEnabled && !params.testMode && result.status === "no_vendor_configured") {
    Sentry.captureMessage("SOS_IVR_NO_VENDOR", {
      level: "error",
      tags: {
        sos_event_id: params.sosEventId,
        vendor,
        phone_country: params.contact.phone.startsWith("+91") ? "in" : "intl",
      },
      extra: {
        correlationId: params.correlationId,
        reason: result.errorMessage,
      },
    });
  }

  return result;
};

// ── Patient-household push (so the device shows fullscreen) ──────

const dispatchPatientHouseholdPush = async (params: {
  sosEventId: string;
  patientUserId: string;
  patientName: string;
  testMode: boolean;
}): Promise<DispatchLogEntry[]> => {
  const { tokens } = await resolveHouseholdDelivery(params.patientUserId);
  if (tokens.length === 0) return [];

  if (params.testMode) {
    // Even in test mode we record an entry per token so the audit
    // chain shows we WOULD have notified the household. `channel:
    // "push"` rather than `log_only` because the dispatch decision
    // was real — only the network call was suppressed.
    return tokens.map<DispatchLogEntry>((token) => ({
      contactId: `household:${token.slice(0, 6)}`,
      stage: "stage_0_fullscreen",
      channel: "push",
      at: new Date().toISOString(),
      status: "skipped_test_mode",
      reason: "sos_test_mode=true",
    }));
  }

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t,
    title: `🚨 SOS — ${params.patientName}`,
    body: "Open the app — emergency in progress.",
    sound: "default",
    priority: "high",
    channelId: "critical",
    data: {
      type: "sos_active",
      sosEventId: params.sosEventId,
      // §D'.2: a tap opens the app focused on the right profile when
      // the household has multiple sub-profiles on the shared device.
      targetUserId: params.patientUserId,
    },
  }));

  const results = await sendExpoPush(messages);
  return results.map<DispatchLogEntry>((r) => ({
    contactId: `household:${r.token.slice(0, 6)}`,
    stage: "stage_0_fullscreen",
    channel: "push",
    at: new Date().toISOString(),
    status: r.success ? "delivered" : "failed",
    ...(r.errorCode ? { reason: r.errorCode } : {}),
  }));
};

// ── Per-contact dispatch (SMS + IVR) ─────────────────────────────

const dispatchContact = async (params: {
  contact: SOSContact;
  stage: SOSStage;
  sosEventId: string;
  patientName: string;
  testMode: boolean;
  ivrEnabled: boolean;
}): Promise<DispatchLogEntry[]> => {
  const correlationId = `sos-${params.sosEventId}-${params.contact.id}-${randomUUID().slice(0, 8)}`;
  const msg = buildSOSMessage({
    patientName: params.patientName,
    language: "hi",
  });

  if (params.testMode) {
    return [
      {
        contactId: params.contact.id,
        stage: params.stage,
        channel: "log_only",
        at: new Date().toISOString(),
        status: "skipped_test_mode",
        reason: "sos_test_mode=true",
        correlationId,
      },
    ];
  }

  // SMS — always fired at every stage past stage_0 so the contact
  // has a written record even if the IVR misses them. MSG91 batches
  // a single phone fine.
  const smsResults = await sendSmsBatch([{ phone: params.contact.phone, message: msg.sms }]);
  const smsEntry: DispatchLogEntry = {
    contactId: params.contact.id,
    stage: params.stage,
    channel: "sms",
    at: new Date().toISOString(),
    status: smsResults[0]?.success ? "delivered" : "failed",
    ...(smsResults[0]?.errorCode ? { reason: smsResults[0].errorCode } : {}),
    correlationId,
  };

  // IVR — only at stages that the spec demands it (`stage_1` /
  // `stage_2`). `stage_3` is the dead-mans-switch broadcast and uses
  // SMS only to avoid waking everyone with a phone call at once.
  const ivrStages: SOSStage[] = ["stage_1_auto_dial", "stage_2_ivr_call"];
  if (!ivrStages.includes(params.stage)) return [smsEntry];

  const ivr = await dispatchIvr({
    contact: params.contact,
    script: msg.ivrScript,
    correlationId,
    testMode: false, // we're in the !testMode branch already
    ivrEnabled: params.ivrEnabled,
    sosEventId: params.sosEventId,
  });

  const ivrEntry: DispatchLogEntry = {
    contactId: params.contact.id,
    stage: params.stage,
    channel: "ivr",
    at: new Date().toISOString(),
    status:
      ivr.status === "queued"
        ? "queued"
        : ivr.status === "test_mode_skipped"
          ? "skipped_test_mode"
          : "failed",
    ...(ivr.errorMessage ? { reason: ivr.errorMessage } : {}),
    ...(ivr.vendorCallId ? { vendorCallId: ivr.vendorCallId } : {}),
    correlationId,
  };

  return [smsEntry, ivrEntry];
};

// ── Main processor ───────────────────────────────────────────────

export const processSOSEscalation = async (job: Job<SOSEscalationJob>): Promise<void> => {
  const { sosEventId, requestId } = job.data;
  const log = logger.child({
    queue: QUEUE_NAMES.SOS_ESCALATION,
    jobId: job.id ?? undefined,
    sosEventId,
    ...(requestId ? { requestId } : {}),
  });

  const sosEnabled = await getFlag<boolean>("sos_enabled", false);
  if (!sosEnabled) {
    log.warn("sos_enabled=false — skipping tick, NOT rescheduling");
    return;
  }

  // `sos_ivr_enabled` gates the IVR sub-feature independently. When
  // false the dispatcher skips Exotel/Twilio entirely, relying on
  // push + SMS only. Default false until ops promote.
  const ivrEnabled = await getFlag<boolean>("sos_ivr_enabled", false);

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

  const testMode = event.testMode;
  const elapsedSeconds = Math.floor((Date.now() - event.triggeredAt.getTime()) / 1000);
  const existingLog: DispatchLogEntry[] = isContactsNotifiedArray(event.contactsNotified)
    ? event.contactsNotified
    : [];

  // FIRST tick (no entries yet) → fire the household-primary push
  // so the elderly shared device shows the fullscreen overlay even
  // if the patient was already in another app when SOS triggered.
  const isFirstTick = existingLog.length === 0;
  let pushEntries: DispatchLogEntry[] = [];
  if (isFirstTick) {
    pushEntries = await dispatchPatientHouseholdPush({
      sosEventId,
      patientUserId: event.userId,
      patientName: event.user.name || "Patient",
      testMode,
    });
  }

  const transition = nextSOSStage({
    currentStage: event.escalationStage,
    elapsedSecondsSinceTrigger: elapsedSeconds,
    patientCancelled: event.cancelledBy === "patient",
    externallyCancelled: event.cancelledBy !== null && event.cancelledBy !== "patient",
    resolved: event.resolvedAt !== null,
    anyContactAnsweredCall: detectAnyAnswered(existingLog),
  });

  let newDispatchEntries: DispatchLogEntry[] = [...pushEntries];

  if (transition.changed) {
    log.warn(
      {
        from: event.escalationStage,
        to: transition.nextStage,
        reason: transition.reason,
        elapsedSeconds,
        testMode,
        ivrEnabled,
      },
      "SOS stage transition",
    );

    if (isSOSChainActive(transition.nextStage)) {
      const contacts: SOSContact[] = event.user.emergencyContacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        priority: c.priority,
        isGuardian: c.isGuardian,
      }));
      // `attemptedIds` from the per-stage perspective — a contact
      // already attempted at THIS stage is skipped, but contacts
      // attempted in earlier stages get a fresh attempt for the new
      // stage's channel mix.
      const sameStageAttempted = existingLog
        .filter((e) => e.stage === transition.nextStage)
        .map((e) => e.contactId);
      const stageContacts = contactsForStage(transition.nextStage, contacts, sameStageAttempted);

      for (const c of stageContacts) {
        const entries = await dispatchContact({
          contact: c,
          stage: transition.nextStage,
          sosEventId,
          patientName: event.user.name || "Patient",
          testMode,
          ivrEnabled,
        });
        newDispatchEntries = newDispatchEntries.concat(entries);
      }
    }

    captureAnalyticsEvent("sos_stage_transition", event.userId, {
      sos_event_id: sosEventId,
      from: event.escalationStage,
      to: transition.nextStage,
      reason: transition.reason,
      elapsed_seconds: elapsedSeconds,
      test_mode: testMode,
      contacts_in_stage: newDispatchEntries.filter((e) => e.channel !== "push").length,
    });
  }

  if (transition.changed || newDispatchEntries.length > 0) {
    await prisma.sOSEvent.update({
      where: { id: sosEventId },
      data: {
        escalationStage: transition.nextStage,
        contactsNotified: [
          ...existingLog,
          ...newDispatchEntries,
        ] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  if (isSOSChainActive(transition.nextStage)) {
    await sosQueue().add(
      QUEUE_NAMES.SOS_ESCALATION,
      { sosEventId, ...(requestId !== undefined ? { requestId } : {}) },
      { delay: SOS_TICK_INTERVAL_MS, jobId: `${sosEventId}-${Date.now()}` },
    );
  }
};
