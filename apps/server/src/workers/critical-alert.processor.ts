import { randomUUID } from "node:crypto";
import type { BypassDecision, MultiCategoryBypassDispatch } from "@swasth/domain-logic";
import type { Job, Queue } from "bullmq";
import type { Language } from "@prisma/client";
import { isTest } from "../config/env.js";
import { createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { withTimeout } from "../shared/with-timeout.js";
import type { CriticalBypassAutoEscalateJob } from "./critical-bypass-auto-escalate.processor.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../shared/database.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";
import { sendSmsBatch, type SmsMessage } from "../shared/notifications/msg91-sms.js";
import { householdUserIds } from "../shared/notifications/household-delivery.js";
import { notif } from "../shared/i18n/notifications.js";

/**
 * Two shapes feed this worker. Glucose continues to use the original
 * `BypassDecision` shape (Phase 1 — historic, byte-identical behaviour
 * preserved). BP, cardiac and respiratory ride the new multi-category
 * dispatch shape from `planMultiCategoryBypassDispatch`. The two paths
 * share the helpers below (push-token resolution, SMS, PostHog) but
 * branch on shape so glucose can never regress while the new categories
 * roll in.
 */
export type CriticalAlertJob =
  | (CriticalAlertGlucoseJob & { category?: "glucose" })
  | CriticalAlertMultiCategoryJob;

/**
 * Audit P33: set when the reading reached the server more than 2h after it
 * was taken. The family is told, with that time; the patient's own phone
 * isn't re-alerted, and no SOS escalation or on-call page follows.
 */
export interface LateCriticalReading {
  measuredAtIso: string;
}

export interface CriticalAlertGlucoseJob {
  readingId: string;
  userId: string;
  decision: BypassDecision;
  late?: LateCriticalReading;
  // Forwarded from the originating HTTP request so the dispatch log line
  // joins the request log under the same requestId. Optional — jobs
  // enqueued from cron paths (none today, but kept resilient) emit with
  // jobId-only correlation.
  requestId?: string;
}

export interface CriticalAlertMultiCategoryJob {
  category: "bp" | "cardiac" | "respiratory";
  readingId: string;
  userId: string;
  dispatch: MultiCategoryBypassDispatch;
  late?: LateCriticalReading;
  /**
   * Numeric payload the worker reads to build the localised SMS body.
   * Shape is category-specific; the worker treats this as opaque data
   * and only forwards into the i18n bundle. Snapshotting at enqueue
   * time keeps the alert body stable even if the row is edited mid-
   * cooldown.
   */
  copyParams: {
    systolic?: number;
    diastolic?: number;
    heartRateBpm?: number;
    painSeverity?: number;
    peakFlow?: number;
    baselinePeakFlow?: number;
  };
  requestId?: string;
}

const copyForSeverity = (
  severity: "low" | "high",
  valueMgDl: number,
  patientName: string,
  language: Language,
): { title: string; body: string } =>
  notif(
    severity === "low" ? "critical_bypass_low" : "critical_bypass_high",
    { patientName, valueMgDl },
    language,
  );

// SMS copy goes to emergency contacts who have no language preference
// of their own — we mirror the patient's language so the family
// conversation stays consistent. "ALERT" prefix stays English in both
// bundles for cross-language recognisability.
const smsCopy = (
  severity: "low" | "high",
  valueMgDl: number,
  patientName: string,
  language: Language,
): string => {
  if (language === "en") {
    const label = severity === "low" ? "VERY LOW" : "VERY HIGH";
    return `SwasthParivar ALERT: ${patientName}'s sugar is ${label} (${valueMgDl} mg/dL). Please call now.`;
  }
  const label = severity === "low" ? "KAM" : "ZYADA";
  return `SwasthParivar ALERT: ${patientName} ka sugar BAHUT ${label} hai (${valueMgDl} mg/dL). Turant call karein.`;
};

// BP SMS, plain ASCII like the glucose one above. The push copy's emoji
// and em dash would force UCS-2, splitting the alert into several SMS
// parts that can arrive out of order or partly (P4 review W7).
const bpSmsCopy = (
  severity: "low" | "high",
  systolic: number,
  diastolic: number,
  patientName: string,
  language: Language,
): string => {
  if (language === "en") {
    const label = severity === "low" ? "VERY LOW" : "VERY HIGH";
    return `SwasthParivar ALERT: ${patientName}'s BP is ${label} (${systolic}/${diastolic} mmHg). Please call now.`;
  }
  const label = severity === "low" ? "KAM" : "ZYADA";
  return `SwasthParivar ALERT: ${patientName} ka BP BAHUT ${label} hai (${systolic}/${diastolic} mmHg). Turant call karein.`;
};

interface PushRecipients {
  /** Every token to push — patient household + guardian contacts, de-duplicated. */
  readonly tokens: string[];
  /**
   * Guardian contactId → tokens owned by the user whose phone IS that
   * contact's phone. Only these tokens prove the contact was reached —
   * the patient's own device never does (P1).
   */
  readonly tokensByContact: ReadonlyMap<string, ReadonlySet<string>>;
}

const resolvePushRecipients = async (
  userId: string,
  guardianContactIds: readonly string[],
  includePatientDevice: boolean,
): Promise<PushRecipients> => {
  // The patient's OWN device always receives the alert push, so the
  // alert shows on the patient's phone. Guardian contacts ADD to this set;
  // their absence does NOT skip the patient's own device (a solo patient
  // with no family link still gets the push).
  const patientHouseholdIds = await householdUserIds(userId);
  // A contact whose phone belongs to the patient's own household (a
  // sub-profile's auto-seeded primary contact, or a patient who saved
  // their own number) shares the patient's device, so a push there never
  // proves that person was reached — they are texted instead.
  const ownHousehold = new Set(patientHouseholdIds);

  // contactId → userIds whose phone matches the contact's phone.
  const contactUserIds = new Map<string, string[]>();
  if (guardianContactIds.length > 0) {
    const contacts = await prisma.emergencyContact.findMany({
      where: { id: { in: [...guardianContactIds] } },
      select: { id: true, phone: true },
    });
    const users =
      contacts.length > 0
        ? await prisma.user.findMany({
            where: { phone: { in: contacts.map((c) => c.phone) } },
            select: { id: true, phone: true },
          })
        : [];
    for (const contact of contacts) {
      contactUserIds.set(
        contact.id,
        users.filter((u) => u.phone === contact.phone && !ownHousehold.has(u.id)).map((u) => u.id),
      );
    }
  }

  const allUserIds = [
    ...new Set([
      ...(includePatientDevice ? patientHouseholdIds : []),
      ...[...contactUserIds.values()].flat(),
    ]),
  ];
  const tokenRows = await prisma.pushToken.findMany({
    where: { userId: { in: allUserIds } },
    select: { token: true, userId: true },
  });

  const tokensByContact = new Map<string, ReadonlySet<string>>();
  for (const [contactId, ids] of contactUserIds) {
    tokensByContact.set(
      contactId,
      new Set(tokenRows.filter((t) => ids.includes(t.userId)).map((t) => t.token)),
    );
  }
  return { tokens: [...new Set(tokenRows.map((t) => t.token))], tokensByContact };
};

interface FanOutInput {
  readonly userId: string;
  readonly triggerPush: boolean;
  readonly triggerSmsFallback: boolean;
  /** Guardian contactIds (push-capable) — from the bypass decision. */
  readonly pushTargets: readonly string[];
  /** Every emergency contactId in priority order — from the bypass decision. */
  readonly smsTargets: readonly string[];
  readonly buildPushMessage: (token: string) => ExpoPushMessage;
  /**
   * False for a late reading (audit P33): the patient's own phone is not
   * re-alerted (it raised the alert when the reading was taken).
   */
  readonly includePatientDevice: boolean;
  readonly smsText: string;
  readonly log: typeof logger;
  /** Extra props for the push_zero_recipients analytics event. */
  readonly analytics: { readonly category?: "bp" | "cardiac" | "respiratory" };
}

interface FanOutResult {
  readonly pushSuccessCount: number;
  /** Contacts whose OWN device received the push. */
  readonly contactsReachedByPush: number;
  /** Contacts not reached by push, so texted instead. */
  readonly smsContacts: number;
  /** An SMS was actually attempted (some texted contact still exists). */
  readonly smsTriggered: boolean;
  readonly smsSuccessCount: number;
  /** Contacts whose SMS still failed after every retry. */
  readonly smsFailedCount: number;
}

// CLAUDE.md "Fallback Mechanisms": SMS fails → retry 3x. One backoff per
// retry; only the contacts whose SMS failed are re-sent.
const SMS_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sends one SMS per contact, retrying failures. Returns the contactIds delivered. */
const sendSmsWithRetry = async (
  contacts: readonly { id: string; phone: string }[],
  text: string,
): Promise<ReadonlySet<string>> => {
  const delivered = new Set<string>();
  let pending = contacts;
  for (const backoffMs of [0, ...SMS_RETRY_BACKOFF_MS]) {
    if (backoffMs > 0) await sleep(isTest ? 0 : backoffMs);
    // sendSmsBatch returns one result per message, in message order.
    const results = await sendSmsBatch(pending.map((c) => ({ phone: c.phone, message: text })));
    pending = pending.filter((c, i) => {
      const r = results[i];
      if (r?.success === true) {
        delivered.add(c.id);
        return false;
      }
      // Retrying cannot fix a missing MSG91 configuration.
      return r?.errorCode !== "NOT_CONFIGURED";
    });
    if (pending.length === 0) break;
  }
  return delivered;
};

/**
 * Push + SMS fan-out shared by every critical-bypass category.
 *
 * CLAUDE.md edge case #3: push to every guardian contact who has the app;
 * SMS to every contact the push did NOT reach. A contact counts as reached
 * only when a push succeeded to a device owned by the user whose phone is
 * that contact's phone. The patient's own device always gets the push but
 * never counts as reaching a contact —
 * previously one successful push to the patient's phone suppressed SMS to
 * every emergency contact, including those without the app (P1).
 */
const fanOutCriticalAlert = async (input: FanOutInput): Promise<FanOutResult> => {
  const { userId, log } = input;
  const reachedContactIds = new Set<string>();
  let pushSuccessCount = 0;

  if (input.triggerPush) {
    try {
      const { tokens, tokensByContact } = await resolvePushRecipients(
        userId,
        input.pushTargets,
        input.includePatientDevice,
      );
      if (tokens.length > 0) {
        // sendExpoPush returns one result per message, in message order.
        const results = await sendExpoPush(tokens.map(input.buildPushMessage));
        const delivered = new Set(tokens.filter((_, i) => results[i]?.success === true));
        pushSuccessCount = delivered.size;
        for (const [contactId, contactTokens] of tokensByContact) {
          if ([...contactTokens].some((t) => delivered.has(t))) reachedContactIds.add(contactId);
        }
      } else {
        // Distinguish "no recipients at all" (patient + guardians both have
        // zero tokens — usually the device never registered) from "guardian
        // contacts unreachable". Both fall through to SMS.
        const reason =
          input.pushTargets.length === 0
            ? "no_tokens_in_household"
            : "no_tokens_for_resolved_recipients";
        log.warn(
          { userId, guardianContacts: input.pushTargets.length, reason },
          "critical-alert: zero push tokens — falling through to SMS",
        );
        const householdSize = (await householdUserIds(userId)).length;
        captureAnalyticsEvent("push_zero_recipients", userId, {
          surface: "critical_alert",
          ...input.analytics,
          reason,
          household_size: householdSize,
        });
      }
    } catch (err) {
      // A push-stage failure (token lookup, Expo client) must never cost
      // the SMS fallback: every contact counts as unreached and is texted.
      log.error({ err, userId }, "critical-alert: push stage failed — falling through to SMS");
      captureUnhandled(err, { userId, stage: "critical_alert_push" });
      reachedContactIds.clear();
    }
  }

  // Priority order is preserved from the decision's smsTargets.
  const smsContactIds = input.smsTargets.filter((id) => !reachedContactIds.has(id));

  let smsTriggered = false;
  let smsSuccessCount = 0;
  let smsFailedCount = 0;
  if (input.triggerSmsFallback && smsContactIds.length > 0) {
    const rows = await prisma.emergencyContact.findMany({
      where: { id: { in: smsContactIds } },
      select: { id: true, phone: true },
    });
    const contacts = smsContactIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((c): c is { id: string; phone: SmsMessage["phone"] } => c !== undefined);
    if (contacts.length > 0) {
      smsTriggered = true;
      const delivered = await sendSmsWithRetry(contacts, input.smsText);
      for (const c of contacts) {
        if (delivered.has(c.id)) smsSuccessCount++;
        else smsFailedCount++;
        captureAnalyticsEvent("critical_sms_per_contact", userId, {
          contact_id: c.id,
          delivered: delivered.has(c.id),
        });
      }
    }
  }

  return {
    pushSuccessCount,
    contactsReachedByPush: reachedContactIds.size,
    smsContacts: smsContactIds.length,
    smsTriggered,
    smsSuccessCount,
    smsFailedCount,
  };
};

/**
 * On-call must be paged when a critical alert reached nobody who can help.
 * With emergency contacts: none of them was reached by their own push or by
 * SMS (the patient's own device doesn't count). Without contacts: nothing
 * was delivered at all. Never pages when push was not meant to fire (within
 * the cooldown window — CLAUDE.md edge case #1).
 */
const reachedNoOne = (
  triggerPush: boolean,
  contactCount: number,
  result: FanOutResult,
): boolean => {
  if (!triggerPush) return false;
  if (contactCount > 0) return result.contactsReachedByPush + result.smsSuccessCount === 0;
  return result.pushSuccessCount === 0;
};

/**
 * Pages on-call when nobody who can help was reached, or when some
 * contacts' SMS still failed after every retry (CLAUDE.md: "SMS fails →
 * retry 3x" then page). One page per dispatch at most.
 */
const pageIfUndelivered = (
  triggerPush: boolean,
  contactCount: number,
  result: FanOutResult,
  context: Record<string, unknown>,
): void => {
  if (reachedNoOne(triggerPush, contactCount, result)) {
    captureUnhandled(new Error("critical bypass dispatch reached no remote recipient"), context);
  } else if (result.smsFailedCount > 0) {
    captureUnhandled(new Error("critical bypass SMS failed after retries"), {
      ...context,
      smsFailed: result.smsFailedCount,
    });
  }
};

/**
 * Pure processor — no side effects on import. The companion
 * `critical-alert.worker.ts` wraps this in `createWorker` to actually
 * pull jobs in production. Tests import THIS module to exercise the
 * full chain without booting a real BullMQ listener.
 *
 * Glucose jobs (the historical shape — no `category` discriminator)
 * route to the unchanged glucose path. BP + cardiac + respiratory ride a
 * parallel branch that reuses the push/SMS helpers but speaks the
 * category-specific copy bundle.
 */
/**
 * The processor reads only `id` and `data`, so the in-process fallback
 * (`critical-alert.enqueue.ts`) can call it without a real BullMQ Job.
 */
export type CriticalAlertJobRef<T extends CriticalAlertJob = CriticalAlertJob> = Pick<
  Job<T>,
  "id" | "data"
>;

// ─────────────────────────────────────────────────────────────
// Audit P33 — a critical reading that synced > 2h after it was taken.
// The family is told, with when it was taken; it is not an emergency page.
// ─────────────────────────────────────────────────────────────

// Same fixed IST offset the readings service uses for the patient's day.
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "22:10" today (IST), "26 Oct 22:10" on another day. ASCII. */
export const formatTakenAt = (measuredAtIso: string, now: Date = new Date()): string => {
  const taken = new Date(Date.parse(measuredAtIso) + IST_OFFSET_MS);
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  const hhmm = `${pad2(taken.getUTCHours())}:${pad2(taken.getUTCMinutes())}`;
  const sameDay = taken.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  return sameDay ? hhmm : `${taken.getUTCDate()} ${MONTHS[taken.getUTCMonth()] ?? ""} ${hhmm}`;
};

/** Short ASCII label for the late notice, e.g. "Sugar 52 mg/dL", "BP 190/120 mmHg". */
const lateReadingLabel = (
  category: "glucose" | CriticalAlertMultiCategoryJob["category"],
  p: CriticalAlertMultiCategoryJob["copyParams"] & { valueMgDl?: number },
  copyKey: string | null,
  language: Language,
): string => {
  const en = language === "en";
  switch (category) {
    case "glucose":
      return `Sugar ${p.valueMgDl ?? 0} mg/dL`;
    case "bp":
      return `BP ${p.systolic ?? 0}/${p.diastolic ?? 0} mmHg`;
    case "cardiac":
      return copyKey === "critical.cardiac.chest_pain"
        ? `${en ? "Chest pain" : "Seene mein dard"} ${p.painSeverity ?? 0}/10`
        : `${en ? "Heart rate" : "Dhadkan"} ${p.heartRateBpm ?? 0}/min`;
    case "respiratory":
      return p.peakFlow !== undefined && copyKey === "critical.respiratory.peak_flow"
        ? `Peak flow ${p.peakFlow} L/min`
        : en
          ? "Severe breathing trouble"
          : "Saans ki gambhir takleef";
  }
};

// Plain ASCII like the other critical SMS: one GSM-7 part.
const lateSmsCopy = (
  patientName: string,
  reading: string,
  takenAt: string,
  language: Language,
): string =>
  language === "en"
    ? `SwasthParivar: ${patientName}'s reading from ${takenAt} was critical (${reading}). It synced just now. Please call to check on them.`
    : `SwasthParivar: ${patientName} ki ${takenAt} baje ki reading critical thi (${reading}). Abhi sync hui. Call karke haal poochh lein.`;

/**
 * Sends the late notice: family push (not the patient's own phone) and SMS
 * to contacts the push didn't reach, under the same per-contact rules as a
 * live alert. No on-call page and no SOS escalation: it is not a current
 * emergency.
 */
const processLateCriticalReading = async (input: {
  category: "glucose" | CriticalAlertMultiCategoryJob["category"];
  userId: string;
  readingId: string;
  late: LateCriticalReading;
  copyParams: CriticalAlertMultiCategoryJob["copyParams"] & { valueMgDl?: number };
  copyKey: string | null;
  triggerPush: boolean;
  triggerSmsFallback: boolean;
  pushTargets: readonly string[];
  smsTargets: readonly string[];
  log: typeof logger;
}): Promise<void> => {
  const { category, userId, readingId, late, log } = input;
  const patient = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true },
  });
  const patientName = patient?.name ?? "Patient";
  const language = patient?.preferredLanguage ?? "hi";
  const reading = lateReadingLabel(category, input.copyParams, input.copyKey, language);
  const takenAt = formatTakenAt(late.measuredAtIso);
  const copy = notif("critical_late", { patientName, reading, takenAt }, language);
  const notificationId = randomUUID();

  const result = await fanOutCriticalAlert({
    userId,
    triggerPush: input.triggerPush,
    triggerSmsFallback: input.triggerSmsFallback,
    pushTargets: input.pushTargets,
    smsTargets: input.smsTargets,
    includePatientDevice: false,
    buildPushMessage: (to) => ({
      to,
      title: copy.title,
      body: copy.body,
      sound: "default",
      priority: "high",
      channelId: "critical",
      data: {
        notificationId,
        // Not "critical_alert": the app must not open the fullscreen alert.
        type: "critical_reading_late",
        category,
        readingId,
        userId,
        targetUserId: userId,
        measuredAt: late.measuredAtIso,
      },
    }),
    smsText: lateSmsCopy(patientName, reading, takenAt, language),
    log,
    analytics: category === "glucose" ? {} : { category },
  });

  log.warn(
    {
      userId,
      readingId,
      category,
      measuredAt: late.measuredAtIso,
      pushSuccess: result.pushSuccessCount,
      contactsReachedByPush: result.contactsReachedByPush,
      smsContacts: result.smsContacts,
      smsSuccess: result.smsSuccessCount,
    },
    "late critical reading: family notified",
  );
  // Its own event: `critical_bypass_triggered` feeds the live-alert SMS
  // success metric, which a late notice must not skew.
  captureAnalyticsEvent("critical_reading_late_notified", userId, {
    category,
    minutes_late: Math.round((Date.now() - Date.parse(late.measuredAtIso)) / 60_000),
    push_success: result.pushSuccessCount > 0,
    contacts_reached_by_push: result.contactsReachedByPush,
    sms_contacts: result.smsContacts,
    sms_success: result.smsSuccessCount > 0,
  });
};

export const processCriticalAlert = async (job: CriticalAlertJobRef): Promise<void> => {
  const data = job.data;
  if (data.category === "bp" || data.category === "cardiac" || data.category === "respiratory") {
    await processMultiCategoryCriticalAlert(
      job as CriticalAlertJobRef<CriticalAlertMultiCategoryJob>,
      data,
    );
    return;
  }
  await processGlucoseCriticalAlert(
    job as CriticalAlertJobRef<CriticalAlertGlucoseJob>,
    data as CriticalAlertGlucoseJob,
  );
};

const processGlucoseCriticalAlert = async (
  job: CriticalAlertJobRef<CriticalAlertGlucoseJob>,
  data: CriticalAlertGlucoseJob,
): Promise<void> => {
  const { decision, userId, readingId, requestId } = data;
  const log = logger.child({
    queue: QUEUE_NAMES.CRITICAL_ALERT,
    jobId: job.id ?? undefined,
    ...(requestId ? { requestId } : {}),
  });
  if (!decision.isCritical || decision.severity === null) return;

  const patient = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true },
  });
  const patientName = patient?.name ?? "Patient";
  const language = patient?.preferredLanguage ?? "hi";

  const reading = await prisma.glucoseReading.findFirst({
    where: { id: readingId },
    select: { valueMgDl: true },
  });
  const value = reading?.valueMgDl ?? 0;

  if (data.late) {
    await processLateCriticalReading({
      category: "glucose",
      userId,
      readingId,
      late: data.late,
      copyParams: { valueMgDl: value },
      copyKey: decision.copyKey,
      triggerPush: decision.triggerPush,
      triggerSmsFallback: decision.triggerSmsFallback,
      pushTargets: decision.pushTargets,
      smsTargets: decision.smsTargets,
      log,
    });
    return;
  }

  const copy = copyForSeverity(decision.severity, value, patientName, language);
  const severity = decision.severity;
  const notificationId = randomUUID();

  // Push fires whenever the bypass says to, REGARDLESS of whether guardian
  // contacts exist — the patient's own device is always a target
  // (fullscreen alert trigger); guardian-contact tokens are additive.
  const result = await fanOutCriticalAlert({
    userId,
    triggerPush: decision.triggerPush,
    triggerSmsFallback: decision.triggerSmsFallback,
    pushTargets: decision.pushTargets,
    smsTargets: decision.smsTargets,
    includePatientDevice: true,
    buildPushMessage: (to) => ({
      to,
      title: copy.title,
      body: copy.body,
      sound: "default",
      priority: "high",
      channelId: "critical",
      data: {
        notificationId,
        type: "critical_alert",
        readingId,
        userId,
        // Profile this alert is about — lets a tapped notification
        // switch the shared device to the right household profile.
        targetUserId: userId,
        severity,
        // Shown on the app's fullscreen alert raised from this push (P3).
        valueLabel: `${value} mg/dL`,
      },
    }),
    smsText: smsCopy(severity, value, patientName, language),
    log,
    analytics: {},
  });

  log.warn(
    {
      userId,
      readingId,
      severity,
      value,
      pushTargets: decision.pushTargets.length,
      pushSuccess: result.pushSuccessCount,
      contactsReachedByPush: result.contactsReachedByPush,
      smsTargets: decision.smsTargets.length,
      smsContacts: result.smsContacts,
      smsSuccess: result.smsSuccessCount,
    },
    "critical bypass dispatched",
  );

  // The in-app fullscreen alert still fires client-side, but if no one who
  // can help was reached (provider outage, or no reachable emergency
  // contact), on-call must be paged.
  pageIfUndelivered(decision.triggerPush, decision.smsTargets.length, result, {
    userId,
    readingId,
    severity,
    value,
    pushTargets: decision.pushTargets.length,
    smsTargets: decision.smsTargets.length,
    smsTriggered: result.smsTriggered,
  });

  captureAnalyticsEvent("critical_bypass_triggered", userId, {
    value_mg_dl: value,
    severity,
    push_targets: decision.pushTargets.length,
    push_success: result.pushSuccessCount > 0,
    contacts_reached_by_push: result.contactsReachedByPush,
    sms_targets: decision.smsTargets.length,
    sms_contacts: result.smsContacts,
    sms_triggered: result.smsTriggered,
    sms_success: result.smsSuccessCount > 0,
    within_cooldown: decision.withinCooldown,
  });

  // Phase 4 §D'.2 — schedule the SOS auto-escalation 5 minutes after
  // dispatch. The SOS service guards on both `sos_enabled` and
  // `sos_source_critical_bypass_enabled`, so this is a safe no-op
  // until ops promote the feature. The delay matches phase3.md §D
  // ("5min: if no guardian opened app AND no call connected → auto-
  // trigger IVR call").
  await scheduleCriticalBypassAutoEscalation({
    userId,
    readingId,
    category: "glucose",
    ...(requestId !== undefined ? { requestId } : {}),
  });
};

// ─────────────────────────────────────────────────────────────
// Phase 4 Feature E — multi-condition critical-bypass dispatch.
// CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
// Dispatch": the chain (push + SMS + fullscreen + call, all four in
// parallel) is **reused, not re-implemented**. This branch shares the
// `fanOutCriticalAlert` push/SMS helper above and
// the SOS auto-escalation scheduler below — only the copy bundle and
// the queue payload shape differ.
// ─────────────────────────────────────────────────────────────

// Shown on the app's fullscreen alert raised from the push (audit P3).
const multiCategoryValueLabel = (
  category: CriticalAlertMultiCategoryJob["category"],
  p: CriticalAlertMultiCategoryJob["copyParams"],
): { valueLabel: string } | null => {
  if (category === "bp" && p.systolic !== undefined && p.diastolic !== undefined) {
    return { valueLabel: `${p.systolic}/${p.diastolic} mmHg` };
  }
  if (category === "cardiac" && p.heartRateBpm !== undefined) {
    return { valueLabel: `${p.heartRateBpm} bpm` };
  }
  if (category === "respiratory" && p.peakFlow !== undefined) {
    return { valueLabel: `${p.peakFlow} L/min` };
  }
  return null;
};

const buildMultiCategoryCopy = (
  copyKey: MultiCategoryBypassDispatch["copyKey"],
  copyParams: CriticalAlertMultiCategoryJob["copyParams"],
  patientName: string,
  language: Language,
): { title: string; body: string } => {
  switch (copyKey) {
    case "critical.bp.low":
    case "critical.bp.high":
      return notif(
        copyKey === "critical.bp.low" ? "critical_bypass_bp_low" : "critical_bypass_bp_high",
        {
          patientName,
          systolic: copyParams.systolic ?? 0,
          diastolic: copyParams.diastolic ?? 0,
        },
        language,
      );
    case "critical.cardiac.hr_low":
      return notif(
        "critical_bypass_cardiac_low",
        { patientName, heartRateBpm: copyParams.heartRateBpm ?? 0 },
        language,
      );
    case "critical.cardiac.hr_high":
      return notif(
        "critical_bypass_cardiac_high",
        { patientName, heartRateBpm: copyParams.heartRateBpm ?? 0 },
        language,
      );
    case "critical.cardiac.chest_pain":
      return notif(
        "critical_bypass_cardiac_chest_pain",
        { patientName, painSeverity: copyParams.painSeverity ?? 0 },
        language,
      );
    case "critical.respiratory.peak_flow":
      return notif(
        "critical_bypass_respiratory_peak_flow",
        {
          patientName,
          peakFlow: copyParams.peakFlow ?? 0,
          baselinePeakFlow: copyParams.baselinePeakFlow ?? 0,
        },
        language,
      );
    case "critical.respiratory.severe_symptom":
      return notif("critical_bypass_respiratory_severe", { patientName }, language);
  }
};

const processMultiCategoryCriticalAlert = async (
  job: CriticalAlertJobRef<CriticalAlertMultiCategoryJob>,
  data: CriticalAlertMultiCategoryJob,
): Promise<void> => {
  const { dispatch, userId, readingId, copyParams, category, requestId } = data;
  const log = logger.child({
    queue: QUEUE_NAMES.CRITICAL_ALERT,
    category,
    jobId: job.id ?? undefined,
    ...(requestId ? { requestId } : {}),
  });

  if (data.late) {
    await processLateCriticalReading({
      category,
      userId,
      readingId,
      late: data.late,
      copyParams,
      copyKey: dispatch.copyKey,
      triggerPush: dispatch.triggerPush,
      triggerSmsFallback: dispatch.triggerSmsFallback,
      pushTargets: dispatch.pushTargets,
      smsTargets: dispatch.smsTargets,
      log,
    });
    return;
  }

  const patient = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true },
  });
  const patientName = patient?.name ?? "Patient";
  const language = patient?.preferredLanguage ?? "hi";

  const copy = buildMultiCategoryCopy(dispatch.copyKey, copyParams, patientName, language);
  const notificationId = randomUUID();

  const result = await fanOutCriticalAlert({
    userId,
    triggerPush: dispatch.triggerPush,
    triggerSmsFallback: dispatch.triggerSmsFallback,
    pushTargets: dispatch.pushTargets,
    smsTargets: dispatch.smsTargets,
    includePatientDevice: true,
    buildPushMessage: (to) => ({
      to,
      title: copy.title,
      body: copy.body,
      sound: "default",
      priority: "high",
      channelId: "critical",
      data: {
        notificationId,
        type: "critical_alert",
        category,
        readingId,
        userId,
        targetUserId: userId,
        copyKey: dispatch.copyKey,
        ...(multiCategoryValueLabel(category, copyParams) ?? {}),
      },
    }),
    // Cardiac/respiratory SMS reuse the localised push copy; BP has its
    // own single-part plain-text SMS.
    smsText:
      category === "bp"
        ? bpSmsCopy(
            dispatch.copyKey === "critical.bp.low" ? "low" : "high",
            copyParams.systolic ?? 0,
            copyParams.diastolic ?? 0,
            patientName,
            language,
          )
        : `SwasthParivar ALERT: ${copy.title} — ${copy.body}`,
    log,
    analytics: { category },
  });

  log.warn(
    {
      userId,
      readingId,
      category,
      copyKey: dispatch.copyKey,
      pushTargets: dispatch.pushTargets.length,
      pushSuccess: result.pushSuccessCount,
      contactsReachedByPush: result.contactsReachedByPush,
      smsTargets: dispatch.smsTargets.length,
      smsContacts: result.smsContacts,
      smsSuccess: result.smsSuccessCount,
    },
    "critical bypass dispatched",
  );

  pageIfUndelivered(dispatch.triggerPush, dispatch.smsTargets.length, result, {
    userId,
    readingId,
    category,
    copyKey: dispatch.copyKey,
    pushTargets: dispatch.pushTargets.length,
    smsTargets: dispatch.smsTargets.length,
    smsTriggered: result.smsTriggered,
  });

  captureAnalyticsEvent("critical_bypass_triggered", userId, {
    category,
    copy_key: dispatch.copyKey,
    push_targets: dispatch.pushTargets.length,
    push_success: result.pushSuccessCount > 0,
    contacts_reached_by_push: result.contactsReachedByPush,
    sms_targets: dispatch.smsTargets.length,
    sms_contacts: result.smsContacts,
    sms_triggered: result.smsTriggered,
    sms_success: result.smsSuccessCount > 0,
    within_cooldown: dispatch.withinCooldown,
  });

  // SOS auto-escalation is shared with glucose — same 5-minute "no
  // contact answered" trigger. The SOS service guards itself on flag
  // state, so this is a safe enqueue regardless of category.
  await scheduleCriticalBypassAutoEscalation({
    userId,
    readingId,
    category,
    ...(requestId !== undefined ? { requestId } : {}),
  });
};

const FIVE_MINUTES_MS = 5 * 60_000;

let _autoEscalateQueue: Queue<CriticalBypassAutoEscalateJob> | null = null;
const autoEscalateQueue = (): Queue<CriticalBypassAutoEscalateJob> => {
  _autoEscalateQueue ??= createQueue<CriticalBypassAutoEscalateJob>(
    QUEUE_NAMES.CRITICAL_BYPASS_AUTO_ESCALATE,
  );
  return _autoEscalateQueue;
};

const ESCALATION_SCHEDULE_TIMEOUT_MS = 2_000;

/**
 * Runs AFTER push + SMS went out, so it must never fail the dispatch: a
 * throw here would make BullMQ (or the in-process fallback) retry the
 * whole job and re-alert the family (P5 review N1). A lost escalation is
 * paged instead.
 */
const scheduleCriticalBypassAutoEscalation = async (
  job: CriticalBypassAutoEscalateJob,
): Promise<void> => {
  try {
    await withTimeout(
      autoEscalateQueue().add(QUEUE_NAMES.CRITICAL_BYPASS_AUTO_ESCALATE, job, {
        delay: FIVE_MINUTES_MS,
        // Idempotent: per-reading single job in flight. A duplicate
        // critical-bypass dispatch (retries) collapses.
        jobId: `critbypass-escalate-${job.readingId}`,
      }),
      ESCALATION_SCHEDULE_TIMEOUT_MS,
      "escalation schedule",
    );
  } catch (err) {
    logger.error(
      { err, userId: job.userId, readingId: job.readingId },
      "critical-alert: SOS auto-escalation not scheduled",
    );
    captureUnhandled(err, {
      userId: job.userId,
      readingId: job.readingId,
      stage: "critical_alert_escalation_schedule",
    });
  }
};
