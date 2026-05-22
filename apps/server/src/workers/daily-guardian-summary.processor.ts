// DAILY_GUARDIAN_SUMMARY BullMQ processor — Phase 3 Feature C (C-4).
//
// Once a day (20:00 IST), per guardian: if any yellow-severity
// GuardianAlert was created for their patients in the last 24h, send a
// single digest push. Yellow alerts never push individually (CLAUDE.md
// Alert Fatigue: "Yellow summary only") — this is their delivery path.
//
// Gated by `silent_guardian_alerts_dispatch` — the same flag as the
// per-alert dispatch worker, so enabling delivery turns on both.

import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";

import { prisma } from "../shared/database.js";
import { getFlag } from "../shared/flags/index.js";
import { logger } from "../shared/logger.js";
import { sendExpoPush, type ExpoPushMessage } from "../shared/notifications/expo-push.js";

const DAY_MS = 86_400_000;

export interface DailyGuardianSummaryJob {
  tick: true;
}

export const processDailyGuardianSummary = async (
  _job: Job<DailyGuardianSummaryJob>,
): Promise<void> => {
  const enabled = await getFlag<boolean>("silent_guardian_alerts_dispatch", false);
  if (!enabled) {
    logger.info("daily-guardian-summary: disabled by flag — skipping run");
    return;
  }

  const now = new Date();
  const since = new Date(now.getTime() - DAY_MS);

  const links = await prisma.familyLink.findMany({
    where: { status: "accepted", alertEnabled: true },
    select: { guardianId: true },
  });
  const guardianIds = [...new Set(links.map((l) => l.guardianId))];

  let sent = 0;
  let failures = 0;
  for (const guardianId of guardianIds) {
    try {
      const yellowCount = await prisma.guardianAlert.count({
        where: { guardianId, severity: "yellow", createdAt: { gte: since } },
      });
      if (yellowCount === 0) continue;

      const tokens = await prisma.pushToken.findMany({
        where: { userId: guardianId },
        select: { token: true },
      });
      if (tokens.length === 0) continue;

      const notificationId = randomUUID();
      const messages: ExpoPushMessage[] = tokens.map((t) => ({
        to: t.token,
        title: "Aaj ka summary",
        body: `${yellowCount} baat dhyaan dene layak hai. App mein dekhein.`,
        channelId: "guardian",
        data: { notificationId, type: "guardian_daily_summary" },
      }));
      await sendExpoPush(messages);
      sent += 1;
    } catch (err) {
      failures += 1;
      logger.error({ err, guardianId }, "daily-guardian-summary: guardian failed");
    }
  }

  logger.info(
    { guardians: guardianIds.length, sent, failures },
    "daily-guardian-summary batch complete",
  );
};
