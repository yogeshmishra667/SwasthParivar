// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./appointment-reminder.processor.js` instead.
import type { Worker } from "bullmq";

import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import {
  processAppointmentReminder,
  type AppointmentReminderJob,
} from "./appointment-reminder.processor.js";

export type { AppointmentReminderJob } from "./appointment-reminder.processor.js";

// Hourly, at minute 10 — staggered off the 00/05 minute crons
// (daily-health-score at :00, schedule-compliance at :05) so the ticks
// don't pile onto one Redis round.
const REPEAT_PATTERN = "10 * * * *";
const REPEAT_KEY = "appointment-reminder-hourly";

const queue = createQueue<AppointmentReminderJob>(QUEUE_NAMES.APPOINTMENT_REMINDER);

export const bootstrapAppointmentReminderCron = async (): Promise<void> => {
  await queue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const appointmentReminderWorker: Worker<AppointmentReminderJob> =
  createWorker<AppointmentReminderJob>(
    QUEUE_NAMES.APPOINTMENT_REMINDER,
    processAppointmentReminder,
  );
