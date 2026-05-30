import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { sendExpoPush } from "../shared/notifications/expo-push.js";
import { resolveHouseholdDelivery } from "../shared/notifications/household-delivery.js";
import { capture as captureAnalyticsEvent } from "../shared/analytics/posthog.js";

export interface MedReminderJob {
  scheduleId: string;
  userId: string;
  timeSlot: string;
}

export interface MedMissedAlertJob {
  scheduleId: string;
  userId: string;
  scheduledForIso: string;
}

const missedAlertQueue = createQueue<MedMissedAlertJob>(QUEUE_NAMES.MED_MISSED_ALERT);

const MED_REMINDER_COPY = (
  medicine: string,
  profileName: string | null,
): { title: string; body: string } => ({
  // On a shared-device household the profile name disambiguates whose
  // reminder this is; a single-profile household keeps the bare title.
  title: profileName ? `${profileName} ji: Dawai ka time` : "Dawai ka time",
  body: `${medicine} lene ka time ho gaya. Pani ke saath lein 🙏`,
});

export const medReminderWorker: Worker<MedReminderJob> = createWorker<MedReminderJob>(
  QUEUE_NAMES.MED_REMINDER,
  async (job) => {
    const { scheduleId, userId, timeSlot } = job.data;

    const schedule = await prisma.medicationSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        medicineName: true,
        active: true,
        isCritical: true,
        userId: true,
        user: { select: { name: true } },
      },
    });
    if (!schedule || !schedule.active || schedule.userId !== userId) return;

    // The schedule's owner may be a non-primary household profile whose
    // device token lives under the household primary — resolve delivery
    // across the whole household so the shared phone still rings.
    const { memberIds, tokens } = await resolveHouseholdDelivery(userId);

    if (tokens.length === 0) {
      // No push tokens for any member of this household — the device
      // never registered, or all tokens were pruned by Expo's
      // `DeviceNotRegistered` cleanup. The med-reminder LOCAL
      // notification still fires on-device via expo-notifications, so
      // the user is not silently dropped — but the server-side push
      // path is dead. Surface it so ops can ask the user to reinstall.
      logger.warn(
        { userId, scheduleId, householdSize: memberIds.length },
        "med-reminder: zero push tokens in household — local notification only",
      );
      captureAnalyticsEvent("push_zero_recipients", userId, {
        surface: "med_reminder",
        reason: "no_tokens_in_household",
        household_size: memberIds.length,
      });
    }
    if (tokens.length > 0) {
      const profileName = memberIds.length > 1 ? schedule.user.name : null;
      const copy = MED_REMINDER_COPY(schedule.medicineName, profileName);
      const notificationId = randomUUID();
      await sendExpoPush(
        tokens.map((token) => ({
          to: token,
          title: copy.title,
          body: copy.body,
          sound: "default",
          priority: "high",
          channelId: "medications",
          data: {
            notificationId,
            type: "med_reminder",
            scheduleId,
            timeSlot,
            targetUserId: userId,
          },
        })),
      );
    }

    const scheduledForIso = new Date().toISOString();
    await missedAlertQueue.add(
      "check-missed",
      { scheduleId, userId, scheduledForIso },
      { delay: 60 * 60 * 1000 },
    );
  },
);

export const medMissedAlertWorker: Worker<MedMissedAlertJob> = createWorker<MedMissedAlertJob>(
  QUEUE_NAMES.MED_MISSED_ALERT,
  async (job) => {
    const { scheduleId, userId, scheduledForIso } = job.data;
    const scheduledFor = new Date(scheduledForIso);

    const schedule = await prisma.medicationSchedule.findUnique({
      where: { id: scheduleId },
      select: { medicineName: true, isCritical: true, active: true },
    });
    if (!schedule?.active) return;

    const windowMs = 30 * 60 * 1000;
    const log = await prisma.medicationLog.findFirst({
      where: {
        scheduleId,
        userId,
        status: { in: ["taken", "skipped", "delayed"] },
        respondedAt: {
          gte: new Date(scheduledFor.getTime() - windowMs),
          lte: new Date(scheduledFor.getTime() + 65 * 60 * 1000),
        },
      },
    });

    if (log) return;

    await prisma.medicationLog.create({
      data: {
        scheduleId,
        userId,
        status: "missed_no_response",
        scheduledFor,
      },
    });

    if (!schedule.isCritical) return;

    logger.warn({ userId, scheduleId, medicine: schedule.medicineName }, "critical med missed");
    // Guardian alert for critical meds (Phase 3 will extend this)
  },
);
