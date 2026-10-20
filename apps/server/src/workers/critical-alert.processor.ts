import { randomUUID } from "node:crypto";
import type { BypassDecision, MultiCategoryBypassDispatch } from "@swasth/domain-logic";
import type { Job, Queue } from "bullmq";
import type { Language } from "@prisma/client";
import { createQueue, QUEUE_NAMES } from "../shared/queue.js";
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
 * preserved). Cardiac and respiratory ride the new multi-category
 * dispatch shape from `planMultiCategoryBypassDispatch`. The two paths
 * share the helpers below (push-token resolution, SMS, PostHog) but
 * branch on shape so glucose can never regress while the new categories
 * roll in.
 */
export type CriticalAlertJob =
  (CriticalAlertGlucoseJob & { category?: "glucose" }) | CriticalAlertMultiCategoryJob;

export interface CriticalAlertGlucoseJob {
  readingId: string;
  userId: string;
  decision: BypassDecision;
  // Forwarded from the originating HTTP request so the dispatch log line
  // joins the request log under the same requestId. Optional — jobs
  // enqueued from cron paths (none today, but kept resilient) emit with
  // jobId-only correlation.
  requestId?: string;
}

export interface CriticalAlertMultiCategoryJob {
  category: "cardiac" | "respiratory";
  readingId: string;
  userId: string;
  dispatch: MultiCategoryBypassDispatch;
  /**
   * Numeric payload the worker reads to build the localised SMS body.
   * Shape is category-specific; the worker treats this as opaque data
   * and only forwards into the i18n bundle. Snapshotting at enqueue
   * time keeps the alert body stable even if the row is edited mid-
   * cooldown.
   */
  copyParams: {
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

const resolveGuardianPushTokens = async (
  userId: string,
  guardianContactIds: string[],
): Promise<string[]> => {
  // The patient's OWN device must always receive the fullscreen-alert
  // push — that's how CriticalAlert.tsx triggers in the foreground/
  // background. Guardian contacts ADD to this set; their absence does
  // NOT skip the patient's own device. Previously this whole function
  // short-circuited to `[]` when there were no guardian contacts, which
  // meant a solo patient (no family link) never got the alert push and
  // had to notice the reading visually.
  const patientHouseholdIds = await householdUserIds(userId);

  // Guardian-contact resolution is conditional — only runs when contacts
  // were actually passed in.
  let guardianUserIds: string[] = [];
  if (guardianContactIds.length > 0) {
    const contacts = await prisma.emergencyContact.findMany({
      where: { id: { in: guardianContactIds } },
      select: { phone: true },
    });
    const phones = contacts.map((c) => c.phone);
    if (phones.length > 0) {
      const guardianUsers = await prisma.user.findMany({
        where: { phone: { in: phones } },
        select: { id: true },
      });
      guardianUserIds = guardianUsers.map((u) => u.id);
    }
  }

  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: [...guardianUserIds, ...patientHouseholdIds] } },
    select: { token: true },
  });

  return [...new Set(tokens.map((t) => t.token))];
};

const resolveSmsTargets = async (smsContactIds: string[]): Promise<SmsMessage["phone"][]> => {
  if (smsContactIds.length === 0) return [];
  const contacts = await prisma.emergencyContact.findMany({
    where: { id: { in: smsContactIds } },
    select: { phone: true },
  });
  return contacts.map((c) => c.phone);
};

/**
 * Pure processor — no side effects on import. The companion
 * `critical-alert.worker.ts` wraps this in `createWorker` to actually
 * pull jobs in production. Tests import THIS module to exercise the
 * full chain without booting a real BullMQ listener.
 *
 * Glucose jobs (the historical shape — no `category` discriminator)
 * route to the unchanged glucose path. Cardiac + respiratory ride a
 * parallel branch that reuses the push/SMS helpers but speaks the
 * category-specific copy bundle.
 */
export const processCriticalAlert = async (job: Job<CriticalAlertJob>): Promise<void> => {
  const data = job.data;
  if (data.category === "cardiac" || data.category === "respiratory") {
    await processMultiCategoryCriticalAlert(job as Job<CriticalAlertMultiCategoryJob>, data);
    return;
  }
  await processGlucoseCriticalAlert(
    job as Job<CriticalAlertGlucoseJob>,
    data as CriticalAlertGlucoseJob,
  );
};

const processGlucoseCriticalAlert = async (
  job: Job<CriticalAlertGlucoseJob>,
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

  const copy = copyForSeverity(decision.severity, value, patientName, language);

  let pushSuccessCount = 0;
  const pushFailures: string[] = [];

  // The push branch fires whenever the bypass says to, REGARDLESS of
  // whether guardian contacts exist — the patient's own device is the
  // primary target (fullscreen alert trigger). Guardian-contact tokens
  // are additive. Gating on `pushTargets.length > 0` previously skipped
  // the entire branch for a solo patient with no family link.
  if (decision.triggerPush) {
    const tokens = await resolveGuardianPushTokens(userId, decision.pushTargets);
    if (tokens.length > 0) {
      const notificationId = randomUUID();
      const messages: ExpoPushMessage[] = tokens.map((t) => ({
        to: t,
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
          severity: decision.severity,
        },
      }));
      const results = await sendExpoPush(messages);
      results.forEach((r) => {
        if (r.success) pushSuccessCount++;
        else pushFailures.push(r.token);
      });
    } else {
      // Distinguish "no recipients at all" (patient + guardians both
      // have zero tokens — usually means the device never registered)
      // from "guardian contacts unreachable" (the original branch).
      // Both fall through to SMS, but the cause is different.
      const reason =
        decision.pushTargets.length === 0
          ? "no_tokens_in_household"
          : "no_tokens_for_resolved_recipients";
      log.warn(
        { userId, guardianContacts: decision.pushTargets.length, reason },
        "critical-alert: zero push tokens — falling through to SMS",
      );
      const householdSize = (await householdUserIds(userId)).length;
      captureAnalyticsEvent("push_zero_recipients", userId, {
        surface: "critical_alert",
        reason,
        household_size: householdSize,
      });
    }
  }

  const smsTriggered =
    decision.triggerSmsFallback && (pushSuccessCount === 0 || pushFailures.length > 0);

  let smsSuccessCount = 0;
  if (smsTriggered) {
    const phones = await resolveSmsTargets(decision.smsTargets);
    if (phones.length > 0) {
      const smsText = smsCopy(decision.severity, value, patientName, language);
      const results = await sendSmsBatch(phones.map((phone) => ({ phone, message: smsText })));
      smsSuccessCount = results.filter((r) => r.success).length;
    }
  }

  log.warn(
    {
      userId,
      readingId,
      severity: decision.severity,
      value,
      pushTargets: decision.pushTargets.length,
      pushSuccess: pushSuccessCount,
      smsTargets: decision.smsTargets.length,
      smsSuccess: smsSuccessCount,
    },
    "critical bypass dispatched",
  );

  // A critical reading whose dispatch reached NO remote recipient — push
  // delivered to zero devices AND the SMS fallback delivered to zero — is
  // invisible to every guardian. The in-app fullscreen alert still fires
  // client-side, but on-call must be paged: this is either a provider
  // outage or a patient with no reachable emergency contact. Suppressed
  // when push was never meant to fire (e.g. within the cooldown window —
  // CLAUDE.md edge case #1 — where zero remote delivery is intended).
  if (decision.triggerPush && pushSuccessCount === 0 && smsSuccessCount === 0) {
    captureUnhandled(new Error("critical bypass dispatch reached no remote recipient"), {
      userId,
      readingId,
      severity: decision.severity,
      value,
      pushTargets: decision.pushTargets.length,
      smsTargets: decision.smsTargets.length,
      smsTriggered,
    });
  }

  captureAnalyticsEvent("critical_bypass_triggered", userId, {
    value_mg_dl: value,
    severity: decision.severity,
    push_targets: decision.pushTargets.length,
    push_success: pushSuccessCount > 0,
    sms_targets: decision.smsTargets.length,
    sms_triggered: smsTriggered,
    sms_success: smsSuccessCount > 0,
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
    ...(requestId !== undefined ? { requestId } : {}),
  });
};

// ─────────────────────────────────────────────────────────────
// Phase 4 Feature E — multi-condition critical-bypass dispatch.
// CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
// Dispatch": the chain (push + SMS + fullscreen + call, all four in
// parallel) is **reused, not re-implemented**. This branch shares the
// `resolveGuardianPushTokens` + `resolveSmsTargets` helpers above and
// the SOS auto-escalation scheduler below — only the copy bundle and
// the queue payload shape differ.
// ─────────────────────────────────────────────────────────────

const buildMultiCategoryCopy = (
  copyKey: MultiCategoryBypassDispatch["copyKey"],
  copyParams: CriticalAlertMultiCategoryJob["copyParams"],
  patientName: string,
  language: Language,
): { title: string; body: string } => {
  switch (copyKey) {
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
  job: Job<CriticalAlertMultiCategoryJob>,
  data: CriticalAlertMultiCategoryJob,
): Promise<void> => {
  const { dispatch, userId, readingId, copyParams, category, requestId } = data;
  const log = logger.child({
    queue: QUEUE_NAMES.CRITICAL_ALERT,
    category,
    jobId: job.id ?? undefined,
    ...(requestId ? { requestId } : {}),
  });

  const patient = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true },
  });
  const patientName = patient?.name ?? "Patient";
  const language = patient?.preferredLanguage ?? "hi";

  const copy = buildMultiCategoryCopy(dispatch.copyKey, copyParams, patientName, language);

  let pushSuccessCount = 0;
  const pushFailures: string[] = [];

  if (dispatch.triggerPush) {
    const tokens = await resolveGuardianPushTokens(userId, [...dispatch.pushTargets]);
    if (tokens.length > 0) {
      const notificationId = randomUUID();
      const messages: ExpoPushMessage[] = tokens.map((t) => ({
        to: t,
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
        },
      }));
      const results = await sendExpoPush(messages);
      results.forEach((r) => {
        if (r.success) pushSuccessCount++;
        else pushFailures.push(r.token);
      });
    } else {
      const reason =
        dispatch.pushTargets.length === 0
          ? "no_tokens_in_household"
          : "no_tokens_for_resolved_recipients";
      log.warn(
        { userId, guardianContacts: dispatch.pushTargets.length, reason },
        "critical-alert: zero push tokens — falling through to SMS",
      );
      const householdSize = (await householdUserIds(userId)).length;
      captureAnalyticsEvent("push_zero_recipients", userId, {
        surface: "critical_alert",
        category,
        reason,
        household_size: householdSize,
      });
    }
  }

  const smsTriggered =
    dispatch.triggerSmsFallback && (pushSuccessCount === 0 || pushFailures.length > 0);

  let smsSuccessCount = 0;
  if (smsTriggered) {
    const phones = await resolveSmsTargets([...dispatch.smsTargets]);
    if (phones.length > 0) {
      // SMS body uses the localised push body — same bundle, same
      // numeric value. Guardian SMS conversation reads identically to
      // the push title/body the household device received.
      const smsText = `SwasthParivar ALERT: ${copy.title} — ${copy.body}`;
      const results = await sendSmsBatch(phones.map((phone) => ({ phone, message: smsText })));
      smsSuccessCount = results.filter((r) => r.success).length;
    }
  }

  log.warn(
    {
      userId,
      readingId,
      category,
      copyKey: dispatch.copyKey,
      pushTargets: dispatch.pushTargets.length,
      pushSuccess: pushSuccessCount,
      smsTargets: dispatch.smsTargets.length,
      smsSuccess: smsSuccessCount,
    },
    "critical bypass dispatched",
  );

  if (dispatch.triggerPush && pushSuccessCount === 0 && smsSuccessCount === 0) {
    captureUnhandled(new Error("critical bypass dispatch reached no remote recipient"), {
      userId,
      readingId,
      category,
      copyKey: dispatch.copyKey,
      pushTargets: dispatch.pushTargets.length,
      smsTargets: dispatch.smsTargets.length,
      smsTriggered,
    });
  }

  captureAnalyticsEvent("critical_bypass_triggered", userId, {
    category,
    copy_key: dispatch.copyKey,
    push_targets: dispatch.pushTargets.length,
    push_success: pushSuccessCount > 0,
    sms_targets: dispatch.smsTargets.length,
    sms_triggered: smsTriggered,
    sms_success: smsSuccessCount > 0,
    within_cooldown: dispatch.withinCooldown,
  });

  // SOS auto-escalation is shared with glucose — same 5-minute "no
  // contact answered" trigger. The SOS service guards itself on flag
  // state, so this is a safe enqueue regardless of category.
  await scheduleCriticalBypassAutoEscalation({
    userId,
    readingId,
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

export interface CriticalBypassAutoEscalateJob {
  readonly userId: string;
  readonly readingId: string;
  readonly requestId?: string;
}

const scheduleCriticalBypassAutoEscalation = async (
  job: CriticalBypassAutoEscalateJob,
): Promise<void> => {
  await autoEscalateQueue().add(QUEUE_NAMES.CRITICAL_BYPASS_AUTO_ESCALATE, job, {
    delay: FIVE_MINUTES_MS,
    // Idempotent: per-reading single job in flight. A duplicate
    // critical-bypass dispatch (retries) collapses.
    jobId: `critbypass-escalate-${job.readingId}`,
  });
};
