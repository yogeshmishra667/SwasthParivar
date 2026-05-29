// SCHEDULE_COMPLIANCE_CHECK BullMQ processor — Phase 2 carry-over.
//
// Fires hourly. Walks every active `HealthCheckSchedule`, fetches the
// matching reading window for each schedule's `checkType`, runs the
// pure `evaluateCompliance`, and UPSERTs `HealthCheckCompliance` rows
// keyed on `(scheduleId, expectedAt)`.
//
// Idempotent across re-runs: a slot whose status was already `on_time`
// won't flip back to `pending` if the cron re-evaluates an older window
// — the pure evaluator only marks `on_time` when a matching reading is
// inside its grace bucket.
//
// Gated by `schedule_compliance_check_enabled` (default true). When
// false the processor logs and returns — no DB writes, no PostHog.

import type { Job } from "bullmq";

import { prisma } from "../shared/database.js";
import { logger } from "../shared/logger.js";
import { getFlag } from "../shared/flags/index.js";
import { capture } from "../shared/analytics/posthog.js";
import { evaluateAndPersist } from "../modules/schedules/schedules.service.js";

export interface ScheduleComplianceCheckJob {
  tick: true;
}

const KILL_SWITCH_FLAG = "schedule_compliance_check_enabled";

export const processScheduleComplianceCheck = async (
  _job: Job<ScheduleComplianceCheckJob>,
): Promise<void> => {
  const enabled = await getFlag<boolean>(KILL_SWITCH_FLAG, true);
  if (!enabled) {
    logger.info({ flag: KILL_SWITCH_FLAG }, "schedule-compliance cron disabled by flag");
    return;
  }

  const nowIso = new Date().toISOString();
  // Join in the user's timezone so we don't issue one read per row.
  const schedules = await prisma.healthCheckSchedule.findMany({
    where: { active: true },
    include: { user: { select: { timezone: true } } },
  });

  let processed = 0;
  let failures = 0;
  for (const s of schedules) {
    try {
      const counts = await evaluateAndPersist(s.userId, s, s.user.timezone, nowIso);
      capture("schedule_compliance_evaluated", s.userId, {
        schedule_id: s.id,
        check_type: s.checkType,
        on_time_count: counts.onTime,
        late_count: counts.late,
        missed_count: counts.missed,
        pending_count: counts.pending,
      });
      processed += 1;
    } catch (err) {
      failures += 1;
      logger.error(
        { err, scheduleId: s.id, userId: s.userId },
        "schedule-compliance evaluation failed",
      );
    }
  }

  logger.info(
    { processed, failures, totalSchedules: schedules.length },
    "schedule-compliance batch complete",
  );
};
