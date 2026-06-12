// APPOINTMENT_REMINDER BullMQ processor — Phase 4 Feature G.3.
//
// Fires hourly. Scans `scheduled` appointments inside the 7-day reminder
// horizon, runs the pure `dueReminderWindows` per row, and for each due
// window sends a push (via `resolveHouseholdDelivery`, so a shared phone
// still rings) and flips the matching `reminderSent7d/1d/2h` flag.
//
// Idempotent across re-runs: the sent-flag both stops re-firing inside a
// bucket (which spans many hourly ticks) AND is flipped even when zero
// push tokens exist — otherwise a token-less household would be re-scanned
// every hour forever. The on-device local reminder (expo-notifications)
// still fires in that case; only the server push path is dead.
//
// Gated by `doctor_portal_enabled` (default false) — same kill-switch as
// the CRUD surface. Off → log and return, no scan.

import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";

import { dueReminderWindows, REMINDER_OFFSETS_MS, type ReminderWindow } from "@swasth/domain-logic";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { getFlag } from "../shared/flags/index.js";
import { capture } from "../shared/analytics/posthog.js";
import { sendExpoPush } from "../shared/notifications/expo-push.js";
import { resolveHouseholdDelivery } from "../shared/notifications/household-delivery.js";
import { notif, withProfilePrefix } from "../shared/i18n/notifications.js";

export interface AppointmentReminderJob {
  tick: true;
}

const KILL_SWITCH_FLAG = "doctor_portal_enabled";

interface ApptWithRelations {
  id: string;
  userId: string;
  doctorId: string;
  scheduledAt: Date;
  reminderSent7d: boolean;
  reminderSent1d: boolean;
  reminderSent2h: boolean;
  doctor: { name: string };
  user: { name: string; preferredLanguage: Parameters<typeof notif>[2] };
}

const sentFlagData = (window: ReminderWindow): Record<string, boolean> => {
  if (window === "7d") return { reminderSent7d: true };
  if (window === "1d") return { reminderSent1d: true };
  return { reminderSent2h: true };
};

const fireWindow = async (appt: ApptWithRelations, window: ReminderWindow): Promise<void> => {
  const { memberIds, tokens } = await resolveHouseholdDelivery(appt.userId);

  if (tokens.length > 0) {
    const profileName = memberIds.length > 1 ? appt.user.name : null;
    const language = appt.user.preferredLanguage;
    const base = notif("appointment_reminder", { doctorName: appt.doctor.name, window }, language);
    const title = withProfilePrefix(base.title, profileName, language);
    const notificationId = randomUUID();
    await sendExpoPush(
      tokens.map((token) => ({
        to: token,
        title,
        body: base.body,
        sound: "default",
        priority: "high",
        channelId: "default",
        data: {
          notificationId,
          type: "appointment_reminder",
          appointmentId: appt.id,
          doctorId: appt.doctorId,
          window,
          targetUserId: appt.userId,
        },
      })),
    );
  } else {
    logger.warn(
      { userId: appt.userId, appointmentId: appt.id, householdSize: memberIds.length },
      "appointment-reminder: zero push tokens in household — local notification only",
    );
  }

  // Flip the flag regardless of token availability so this window never
  // re-fires (see header note).
  await prisma.doctorAppointment.update({
    where: { id: appt.id },
    data: sentFlagData(window),
  });

  capture("appointment_reminder_sent", appt.userId, {
    appointment_id: appt.id,
    window,
    channel: tokens.length > 0 ? "push" : "none",
  });
};

export const processAppointmentReminder = async (
  _job: Job<AppointmentReminderJob>,
): Promise<void> => {
  const enabled = await getFlag<boolean>(KILL_SWITCH_FLAG, false);
  if (!enabled) {
    logger.info({ flag: KILL_SWITCH_FLAG }, "appointment-reminder cron disabled by flag");
    return;
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + REMINDER_OFFSETS_MS["7d"]);

  // Only future, still-scheduled appointments inside the 7-day horizon
  // with at least one un-sent window. The composite (status, scheduledAt)
  // index serves this scan.
  const appts = (await prisma.doctorAppointment.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { gt: now, lte: horizonEnd },
      OR: [{ reminderSent7d: false }, { reminderSent1d: false }, { reminderSent2h: false }],
    },
    include: {
      doctor: { select: { name: true } },
      user: { select: { name: true, preferredLanguage: true } },
    },
  })) as ApptWithRelations[];

  let sent = 0;
  let failures = 0;
  for (const appt of appts) {
    try {
      const due = dueReminderWindows({
        scheduledAtMs: appt.scheduledAt.getTime(),
        nowMs: now.getTime(),
        sent: {
          "7d": appt.reminderSent7d,
          "1d": appt.reminderSent1d,
          "2h": appt.reminderSent2h,
        },
      });
      for (const window of due) {
        await fireWindow(appt, window);
        sent += 1;
      }
    } catch (err) {
      failures += 1;
      logger.error(
        { err, appointmentId: appt.id, userId: appt.userId },
        "appointment-reminder failed",
      );
    }
  }

  logger.info({ sent, failures, scanned: appts.length }, "appointment-reminder batch complete");
};
