import type { Worker } from "bullmq";
import { createQueue, createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";

// Resets `UserStreak.graceUsedThisWeek` to 0 once per week.
//
// Schedule: Monday 03:00 IST. IST = UTC+5:30, so Monday 03:00 IST equals
// Sunday 21:30 UTC, which is the cron pattern below.
//
// Why a BullMQ repeatable job (not node-cron / setInterval):
//   - Schedule lives in Redis; recovers across server restarts.
//   - Repeatable jobs are idempotent by `key`, so multi-replica deployments
//     don't double-fire.
//   - Matches the existing notification + medication cron pattern.

interface GraceResetJob {
  tick: true;
}

const REPEAT_PATTERN = "30 21 * * 0"; // Sunday 21:30 UTC = Monday 03:00 IST
const REPEAT_KEY = "streak-grace-weekly-reset";

const graceQueue = createQueue<GraceResetJob>(QUEUE_NAMES.GRACE_RESET);

export const bootstrapGraceResetCron = async (): Promise<void> => {
  await graceQueue.add(
    "tick",
    { tick: true },
    {
      repeat: { pattern: REPEAT_PATTERN, tz: "UTC", key: REPEAT_KEY },
      jobId: REPEAT_KEY,
    },
  );
};

export const graceResetWorker: Worker<GraceResetJob> = createWorker<GraceResetJob>(
  QUEUE_NAMES.GRACE_RESET,
  async () => {
    const updated = await prisma.userStreak.updateMany({
      where: { graceUsedThisWeek: { gt: 0 } },
      data: { graceUsedThisWeek: 0 },
    });
    logger.info({ usersReset: updated.count }, "weekly grace counters reset");
  },
);
