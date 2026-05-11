import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { sendExpoPush } from "../shared/notifications/expo-push.js";

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

const MED_REMINDER_COPY = (medicine: string): { title: string; body: string } => ({
  title: "Dawai ka time",
  body: `${medicine} lene ka time ho gaya. Pani ke saath lein 🙏`,
});

export const medReminderWorker: Worker<MedReminderJob> = createWorker<MedReminderJob>(
  QUEUE_NAMES.MED_REMINDER,
  async (job) => {
    const { scheduleId, userId, timeSlot } = job.data;

    const schedule = await prisma.medicationSchedule.findUnique({
      where: { id: scheduleId },
      select: { medicineName: true, active: true, isCritical: true, userId: true },
    });
    if (!schedule || !schedule.active || schedule.userId !== userId) return;

    const tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });

    if (tokens.length > 0) {
      const copy = MED_REMINDER_COPY(schedule.medicineName);
      const notificationId = randomUUID();
      await sendExpoPush(
        tokens.map((t) => ({
          to: t.token,
          title: copy.title,
          body: copy.body,
          sound: "default",
          priority: "high",
          channelId: "medications",
          data: { notificationId, type: "med_reminder", scheduleId, timeSlot },
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
