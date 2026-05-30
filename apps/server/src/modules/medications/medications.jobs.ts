import type { Queue } from "bullmq";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import type { MedReminderJob } from "../../workers/med-reminder.worker.js";
import { logger } from "../../shared/logger.js";

const medQueue: Queue<MedReminderJob> = createQueue<MedReminderJob>(QUEUE_NAMES.MED_REMINDER);

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// BullMQ 5.x forbids ":" in custom jobIds (it's the Redis key delimiter).
// Use "-" as the separator instead. The repeat key uses the same value
// so removeRepeatableByKey() still finds it.
const repeatKey = (scheduleId: string, slot: string): string =>
  `med-${scheduleId}-${slot.replace(":", "-")}`;

export const scheduleMedReminders = async (
  scheduleId: string,
  userId: string,
  timeSlots: string[],
): Promise<void> => {
  for (const slot of timeSlots) {
    const match = HHMM_RE.exec(slot);
    if (!match) {
      logger.warn({ scheduleId, slot }, "invalid time slot format");
      continue;
    }
    const hh = match[1]!;
    const mm = match[2]!;
    const pattern = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;

    await medQueue.add(
      "reminder",
      { scheduleId, userId, timeSlot: slot },
      {
        repeat: { pattern, tz: "Asia/Kolkata", key: repeatKey(scheduleId, slot) },
      },
    );
  }
};

export const cancelMedReminders = async (
  scheduleId: string,
  timeSlots: string[],
): Promise<void> => {
  for (const slot of timeSlots) {
    try {
      await medQueue.removeRepeatableByKey(repeatKey(scheduleId, slot));
    } catch (err) {
      logger.warn({ scheduleId, slot, err }, "failed to remove repeatable job");
    }
  }
};
