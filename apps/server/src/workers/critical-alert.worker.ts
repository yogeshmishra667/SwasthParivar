import { randomUUID } from "node:crypto";
import type { BypassDecision } from "@swasth/domain-logic";
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../shared/database.js";
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";
import { sendSmsBatch, type SmsMessage } from "../shared/notifications/msg91-sms.js";

export interface CriticalAlertJob {
  readingId: string;
  userId: string;
  decision: BypassDecision;
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

  // Also include the patient themselves (they need the fullscreen alert trigger).
  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: [...guardianUserIds, userId] } },
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

export const criticalAlertWorker: Worker<CriticalAlertJob> = createWorker<CriticalAlertJob>(
  QUEUE_NAMES.CRITICAL_ALERT,
  async (job) => {
    const { decision, userId, readingId } = job.data;
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
            severity: decision.severity,
          },
        }));
        const results = await sendExpoPush(messages);
        results.forEach((r) => {
          if (r.success) pushSuccessCount++;
          else pushFailures.push(r.token);
        });
      } else {
        logger.warn({ userId }, "no push tokens for guardians — falling through to SMS");
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

    logger.warn(
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
  },
);
