// Durable hand-off from a saved critical reading to the CRITICAL_ALERT
// worker (audit P5).
//
// A reading row is saved BEFORE its alert is enqueued, so any enqueue
// failure used to lose the alert for good: the client's retry is an
// idempotent replay, which never re-enqueued. Three rules close that:
//
//   1. The enqueue is bounded and never throws. Both Redis clients run
//      with `maxRetriesPerRequest: null`, so during an outage `queue.add`
//      HANGS rather than failing. After ENQUEUE_TIMEOUT_MS (or on an
//      error) the alert is dispatched in-process instead, with its own
//      retries — CLAUDE.md "Fallback Mechanisms: Redis down → bypass".
//   2. One job per reading version (`criticalAlertJobId`), so a replay
//      can safely re-ensure the dispatch: BullMQ ignores an add whose
//      jobId already exists.
//   3. A job that already exhausted its retries is revived, not left to
//      block every re-ensure until `removeOnFail` drops it a day later.
//
// Trade-off: if a timed-out add later lands once Redis recovers, the alert
// goes out twice. A duplicate alert is the safe direction; a lost one is
// not.

import { CRITICAL_COOLDOWN_MINUTES, criticalReadingTiming } from "@swasth/domain-logic";
import type { Queue } from "bullmq";
import { isTest } from "../config/env.js";
import { createQueue, QUEUE_NAMES } from "../shared/queue.js";
import { withTimeout } from "../shared/with-timeout.js";
import { logger } from "../shared/logger.js";
import { captureUnhandled } from "../shared/observability/sentry.js";
import {
  processCriticalAlert,
  type CriticalAlertJob,
  type LateCriticalReading,
} from "./critical-alert.processor.js";

const ENQUEUE_TIMEOUT_MS = 2_000;
const MS_PER_MIN = 60_000;
const COOLDOWN_MS = CRITICAL_COOLDOWN_MINUTES * MS_PER_MIN;
// Mirrors the queue's 3 attempts: first try + 2 retries with backoff.
const INLINE_RETRY_BACKOFF_MS = [1_000, 2_000] as const;

let _criticalQueue: Queue<CriticalAlertJob> | null = null;
const criticalQueue = (): Queue<CriticalAlertJob> => {
  _criticalQueue ??= createQueue<CriticalAlertJob>(QUEUE_NAMES.CRITICAL_ALERT);
  return _criticalQueue;
};

/** One dispatch per reading version. BullMQ forbids ":" in custom ids. */
export const criticalAlertJobId = (job: CriticalAlertJob, version: number): string =>
  `critical-${job.category ?? "glucose"}-${job.readingId}-v${version}`;

/**
 * A replayed request re-ensures the dispatch only while the reading is
 * fresh. Completed jobs are kept for an hour, so inside this window a
 * replay of an already-dispatched reading collapses onto the existing job
 * instead of re-alerting the family about an old reading.
 */
export const isFreshForReplayDispatch = (savedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() - savedAt.getTime() < COOLDOWN_MS;

export interface CriticalTiming {
  /** Set: the family gets a late notice instead of the live chain. */
  readonly late: LateCriticalReading | null;
  /** False: the reading must not start the cooldown (it is too old). */
  readonly startsCooldown: boolean;
}

/**
 * Audit P33: how a critical reading's age changes its dispatch (rules in
 * domain-logic `criticalReadingTiming`). Late — a notice with when it was
 * taken, no cooldown, no patient re-alert, no escalation — only when the
 * request carries the device's own send time (`sentAt`) and both clocks
 * agree it is over 2h old. Without `sentAt` it always gets the live chain.
 *
 * Replays pass the replay request's own `sentAt` and receive time: the
 * stored `updatedAt` is the server's clock, which a phone clock hours off
 * would turn into a false "late" (review B2).
 */
export const criticalTimingOf = (input: {
  measuredAt: Date | string;
  sentAt?: string | null | undefined;
  receivedAt: Date;
}): CriticalTiming => {
  const measuredAtIso =
    typeof input.measuredAt === "string" ? input.measuredAt : input.measuredAt.toISOString();
  const timing = criticalReadingTiming({
    measuredAtIso,
    sentAtIso: input.sentAt ?? null,
    receivedAtIso: input.receivedAt.toISOString(),
  });
  const late =
    timing.late && timing.deviceAgeMs !== null
      ? {
          measuredAtIso,
          // When it was taken on the server's clock: a phone clock hours off
          // would otherwise put the wrong time in the family's notice.
          takenAtIso: new Date(input.receivedAt.getTime() - timing.deviceAgeMs).toISOString(),
          minutesLate: Math.round(timing.deviceAgeMs / 60_000),
        }
      : null;
  return { late, startsCooldown: timing.startsCooldown };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// jobIds being (or already) dispatched in-process, so client retries during
// one outage don't re-alert. A failed dispatch releases its slot so the next
// replay can try again. Per-instance only — another instance may duplicate.
const inlineDispatched = new Map<string, number>();

const dispatchInline = (jobId: string, job: CriticalAlertJob): void => {
  const now = Date.now();
  for (const [id, at] of inlineDispatched) {
    if (now - at > COOLDOWN_MS) inlineDispatched.delete(id);
  }
  if (inlineDispatched.has(jobId)) return;
  inlineDispatched.set(jobId, now);

  // Fire-and-forget: the HTTP response carries the fullscreen-alert decision
  // and must not wait on push + SMS retries.
  void (async () => {
    for (const backoffMs of [0, ...INLINE_RETRY_BACKOFF_MS]) {
      if (backoffMs > 0) await sleep(isTest ? 0 : backoffMs);
      try {
        await processCriticalAlert({ id: jobId, data: job });
        return;
      } catch (err) {
        logger.error({ err, jobId, userId: job.userId }, "critical-alert: inline dispatch failed");
      }
    }
    inlineDispatched.delete(jobId);
    captureUnhandled(new Error("critical-alert: inline dispatch failed after retries"), {
      jobId,
      userId: job.userId,
      stage: "critical_alert_inline_dispatch",
    });
  })();
};

const addOrRevive = async (jobId: string, job: CriticalAlertJob): Promise<void> => {
  const added = await criticalQueue().add("dispatch", job, { jobId });
  // A duplicate jobId is a silent no-op in BullMQ, even when that job has
  // already failed for good — revive it so a re-ensure actually re-sends.
  if ((await added.getState()) !== "failed") return;
  try {
    await added.retry("failed", { resetAttemptsMade: true });
  } catch (err) {
    // A concurrent replay revived it first — only a job still failed is a
    // real failure (P5 review N3).
    if ((await added.getState()) === "failed") throw err;
  }
};

/** Enqueues the critical-alert dispatch; on failure, dispatches in-process. Never throws. */
export const enqueueCriticalAlert = async (
  job: CriticalAlertJob,
  version: number,
): Promise<void> => {
  const jobId = criticalAlertJobId(job, version);
  try {
    await withTimeout(addOrRevive(jobId, job), ENQUEUE_TIMEOUT_MS, "critical-alert enqueue");
  } catch (err) {
    logger.error(
      { err, jobId, userId: job.userId },
      "critical-alert: enqueue failed — dispatching in-process",
    );
    captureUnhandled(err, { jobId, userId: job.userId, stage: "critical_alert_enqueue" });
    dispatchInline(jobId, job);
  }
};
