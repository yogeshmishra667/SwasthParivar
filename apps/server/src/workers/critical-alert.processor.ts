import { randomUUID } from "node:crypto";
import type { BypassDecision } from "@swasth/domain-logic";
import type { Job, Queue } from "bullmq";
import { createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../shared/database.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";
import { sendSmsBatch, type SmsMessage } from "../shared/notifications/msg91-sms.js";
import { householdUserIds } from "../shared/notifications/household-delivery.js";

export interface CriticalAlertJob {
  readingId: string;
  userId: string;
  decision: BypassDecision;
  // Forwarded from the originating HTTP request so the dispatch log line
  // joins the request log under the same requestId. Optional — jobs
  // enqueued from cron paths (none today, but kept resilient) emit with
  // jobId-only correlation.
  requestId?: string;
}

const copyForSeverity = (
  severity: "low" | "high",
  valueMgDl: number,
  patientName: string,
): { title: string; body: string } => {
  if (severity === "low") {
    return {
      title: `⚠️ ${patientName}: Sugar Bahut Kam`,
      body: `Sugar ${valueMgDl} mg/dL hai. Turant kuch meetha dein — juice ya glucose. Call karein.`,
    };
  }
  return {
    title: `⚠️ ${patientName}: Sugar Bahut Zyada`,
    body: `Sugar ${valueMgDl} mg/dL hai. Pani peeyein. Dawai check karein. Call karein.`,
  };
};

const smsCopy = (severity: "low" | "high", valueMgDl: number, patientName: string): string => {
  const label = severity === "low" ? "KAM" : "ZYADA";
  return `SwasthParivar ALERT: ${patientName} ka sugar BAHUT ${label} hai (${valueMgDl} mg/dL). Turant call karein.`;
};

const resolveGuardianPushTokens = async (
  userId: string,
  guardianContactIds: string[],
): Promise<string[]> => {
  if (guardianContactIds.length === 0) return [];

  const contacts = await prisma.emergencyContact.findMany({
    where: { id: { in: guardianContactIds } },
    select: { phone: true },
  });
  const phones = contacts.map((c) => c.phone);
  if (phones.length === 0) return [];

  const guardianUsers = await prisma.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const guardianUserIds = guardianUsers.map((u) => u.id);

  // Also include the patient's own device (they need the fullscreen
  // alert trigger). The reading may belong to a non-primary household
  // profile, whose device token is registered under the household
  // primary — so resolve the whole household, not just `userId`.
  const patientHouseholdIds = await householdUserIds(userId);
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
 */
export const processCriticalAlert = async (job: Job<CriticalAlertJob>): Promise<void> => {
  const { decision, userId, readingId, requestId } = job.data;
  const log = logger.child({
    queue: QUEUE_NAMES.CRITICAL_ALERT,
    jobId: job.id ?? undefined,
    ...(requestId ? { requestId } : {}),
  });
  if (!decision.isCritical || decision.severity === null) return;

  const patient = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const patientName = patient?.name ?? "Patient";

  const reading = await prisma.glucoseReading.findFirst({
    where: { id: readingId },
    select: { valueMgDl: true },
  });
  const value = reading?.valueMgDl ?? 0;

  const copy = copyForSeverity(decision.severity, value, patientName);

  let pushSuccessCount = 0;
  const pushFailures: string[] = [];

  if (decision.triggerPush && decision.pushTargets.length > 0) {
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
      log.warn({ userId }, "no push tokens for guardians — falling through to SMS");
    }
  }

  const smsTriggered =
    decision.triggerSmsFallback && (pushSuccessCount === 0 || pushFailures.length > 0);

  let smsSuccessCount = 0;
  if (smsTriggered) {
    const phones = await resolveSmsTargets(decision.smsTargets);
    if (phones.length > 0) {
      const smsText = smsCopy(decision.severity, value, patientName);
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
