// GUARDIAN_ALERT_DISPATCH BullMQ processor — Phase 3 Feature C (C-4).
//
// Fired once per GuardianAlert created by SILENT_GUARDIAN_ANALYZE.
// Decides whether to push the alert and, if so, delivers it:
//   • yellow alerts never push — they surface in-app + the daily summary
//   • orange alerts push, capped at 2/week per guardian-patient pair
//   • a med-adherence orange is suppressed when a critical-bypass already
//     alerted the guardian about the same patient in the last 30 min
//     (phase3.md CC.11 §2 — alert-fatigue protection)
//   • delivery is push-primary, SMS-fallback (reuses the critical-bypass
//     channel ordering at non-critical priority)
//
// Gated by `silent_guardian_alerts_dispatch`: while off, the alert row
// still exists (visible in-app) but nothing is delivered — shadow mode.
//
// The weekly-cap decision is the pure `shouldDispatchAlert` from
// @swasth/domain-logic; this processor owns the DB reads + delivery.

import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { shouldDispatchAlert } from "@swasth/domain-logic";
import type { AlertChannel } from "@prisma/client";

import { QUEUE_NAMES } from "../shared/queue.js";
import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import { capture } from "../shared/analytics/posthog.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";
import { sendSms } from "../shared/notifications/msg91-sms.js";

const WEEK_MS = 7 * 86_400_000;
const CRITICAL_BYPASS_DEDUP_MS = 30 * 60_000;

export interface GuardianAlertDispatchJob {
  alertId: string;
}

export const processGuardianAlertDispatch = async (
  job: Job<GuardianAlertDispatchJob>,
): Promise<void> => {
  const { alertId } = job.data;
  const log = logger.child({
    queue: QUEUE_NAMES.GUARDIAN_ALERT_DISPATCH,
    jobId: job.id ?? undefined,
    alertId,
  });

  const enabled = await getFlag<boolean>("silent_guardian_alerts_dispatch", false);
  if (!enabled) {
    log.info("guardian-alert-dispatch: disabled by flag — shadow mode, not delivering");
    return;
  }

  const alert = await prisma.guardianAlert.findUnique({ where: { id: alertId } });
  if (!alert) {
    log.warn("guardian-alert-dispatch: alert not found");
    return;
  }
  // Idempotency — a BullMQ retry must never re-deliver. `sentVia` is
  // empty until this worker resolves the alert exactly once (an in-app
  // entry is written even when delivery is suppressed).
  if (alert.sentVia.length > 0) {
    log.debug("guardian-alert-dispatch: already resolved — skipping");
    return;
  }

  const now = new Date();

  // ── dispatch decision: yellow never pushes; orange capped 2/week ──
  const recentPushed = await prisma.guardianAlert.findMany({
    where: {
      patientId: alert.patientId,
      guardianId: alert.guardianId,
      id: { not: alert.id },
      createdAt: { gte: new Date(now.getTime() - WEEK_MS) },
      sentVia: { has: "push" },
    },
    select: { severity: true, createdAt: true },
  });
  const decision = shouldDispatchAlert({
    candidate: { severity: alert.severity, type: alert.alertType },
    recentAlertsThisWeek: recentPushed,
    now,
  });

  // ── critical-bypass dedup (CC.11 §2) ──
  let bypassSuppressed = false;
  if (decision.dispatch && alert.severity === "orange" && alert.alertType === "med_adherence") {
    const recentBypass = await prisma.feedbackEvent.findFirst({
      where: {
        userId: alert.patientId,
        feedbackType: "critical_warn",
        shownAt: { gte: new Date(now.getTime() - CRITICAL_BYPASS_DEDUP_MS) },
      },
    });
    if (recentBypass) bypassSuppressed = true;
  }

  if (!decision.dispatch || bypassSuppressed) {
    // Not pushed — delivered in-app only.
    await prisma.guardianAlert.update({
      where: { id: alert.id },
      data: { sentVia: ["in_app"] },
    });
    // A suppressed ORANGE is alert-fatigue protection worth tracking; a
    // yellow is summary-only by design and is not "suppressed".
    if (alert.severity === "orange") {
      const reason = bypassSuppressed ? "critical_bypass_active_30m" : decision.reason;
      capture("silent_guardian_dedup_suppressed", alert.patientId, {
        reason,
        severity: alert.severity,
        type: alert.alertType,
      });
      log.info({ reason }, "guardian-alert-dispatch: orange alert suppressed");
    }
    return;
  }

  // ── deliver: push primary, SMS fallback ──
  const channels: AlertChannel[] = ["in_app"];

  const tokens = await prisma.pushToken.findMany({
    where: { userId: alert.guardianId },
    select: { token: true },
  });
  let pushSuccess = false;
  if (tokens.length > 0) {
    const notificationId = randomUUID();
    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: alert.title,
      body: alert.summary,
      sound: "default",
      priority: "default",
      channelId: "guardian",
      data: {
        notificationId,
        type: "guardian_alert",
        alertId: alert.id,
        patientId: alert.patientId,
      },
    }));
    const results = await sendExpoPush(messages);
    pushSuccess = results.some((r) => r.success);
  }

  let smsSuccess = false;
  if (pushSuccess) {
    channels.push("push");
  } else {
    // Push reached no device — fall back to a single SMS to the guardian.
    const guardian = await prisma.user.findUnique({
      where: { id: alert.guardianId },
      select: { phone: true },
    });
    if (guardian) {
      const result = await sendSms({
        phone: guardian.phone,
        message: `SwasthParivar: ${alert.title}. ${alert.summary}`,
      });
      smsSuccess = result.success;
      if (smsSuccess) channels.push("sms");
    }
  }

  await prisma.guardianAlert.update({
    where: { id: alert.id },
    data: { sentVia: channels, pushDelivered: pushSuccess, smsDelivered: smsSuccess },
  });

  capture("silent_guardian_alert_dispatched", alert.patientId, {
    severity: alert.severity,
    type: alert.alertType,
    push_success: pushSuccess,
    sms_success: smsSuccess,
  });

  if (!pushSuccess && !smsSuccess) {
    // A guardian alert that reached no remote channel is invisible until
    // the guardian next opens the app. Less acute than a critical-bypass
    // (no IVR escalation), but it still means a real concern went
    // undelivered — capture to Sentry so a provider outage or a guardian
    // with no reachable device surfaces on the delivery dashboard.
    log.warn(
      { guardianId: alert.guardianId },
      "guardian-alert-dispatch: reached no remote channel",
    );
    captureUnhandled(new Error("guardian-alert-dispatch reached no remote channel"), {
      alertId: alert.id,
      guardianId: alert.guardianId,
      patientId: alert.patientId,
      severity: alert.severity,
      pushTokens: tokens.length,
    });
  }
};
