import type { Q as QType } from "@nozbe/watermelondb";
import { isAxiosError } from "axios";
import { getDatabase } from "@/db/database";
import type { PendingWriteModel } from "@/db/models/PendingWrite";
import { api } from "@/services/api";
import { logError, track } from "@/services/analytics";
import { classifyDrainFailure } from "@/services/drain-policy";
import { captureError } from "@/services/sentry";
import { useSyncStore } from "@/stores/sync.store";

/**
 * Offline queue for BP, cardiac, respiratory and meal logs (audit P8).
 * Before it, those screens said "saved locally" and stored nothing.
 *
 * A log the server didn't answer for (network, 5xx, 401, 408, the
 * per-minute 429 — `classifyDrainFailure` "abort") is stored here with its
 * exact POST body. `drainPendingWrites` re-sends it on the same triggers as
 * the glucose queue (`useSyncDrain`). The body keeps its `clientUuid`, so a
 * re-send of a log the server already has is an idempotent replay.
 *
 * Drain rules, the glucose queue's (audit P9) plus:
 *   - delivered: a 2xx, or a stale-version 409 (the server already has this
 *     log or a newer version of it — meals answer 409 to an equal version).
 *   - feature off (CARDIAC_DISABLED / RESPIRATORY_DISABLED 503) or a 5xx
 *     from one endpoint: keep the row and move on, skipping that kind for
 *     the rest of the drain, so one broken endpoint can't hold back a
 *     critical BP behind it. No answer at all, 401, 408, maintenance and
 *     the per-minute 429 are global: the drain stops.
 *   - critical logs go first, newest first: the server's per-category
 *     cooldown lets only the first one alert, so it should be the reading
 *     that is closest to now. Then the rest, oldest first.
 *   - a critical log is never deleted; one the server keeps refusing goes
 *     to Sentry, since that reading will never alert anyone.
 */

export type PendingWriteKind = "bp" | "cardiac" | "respiratory" | "meal";

const ENDPOINTS: Readonly<Record<PendingWriteKind, string>> = {
  bp: "/readings/bp",
  cardiac: "/readings/cardiac",
  respiratory: "/readings/respiratory",
  meal: "/meals",
};

export interface PendingWritePayload {
  clientUuid: string;
  /** The profile the log was made for (shared phone). */
  targetUserId: string;
  [field: string]: unknown;
}

const TABLE = "pending_writes";

const DELIVERED_CODES: ReadonlySet<string> = new Set([
  "READING_STALE_VERSION",
  "MEAL_STALE_VERSION",
]);
const FEATURE_OFF_CODES: ReadonlySet<string> = new Set([
  "CARDIAC_DISABLED",
  "RESPIRATORY_DISABLED",
]);

// A critical log is retried sooner than the 60s tick: the family alert
// goes out only when the server has it.
const CRITICAL_RETRY_MS = [5_000, 15_000, 30_000] as const;

const loadQ = (): typeof QType => {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  return (require("@nozbe/watermelondb") as { Q: typeof QType }).Q;
};

const errorCode = (data: unknown): string | null =>
  (data as { error?: { code?: string } } | null | undefined)?.error?.code ?? null;

const KINDS: ReadonlySet<string> = new Set(Object.keys(ENDPOINTS));
const isPendingWriteKind = (kind: string): kind is PendingWriteKind => KINDS.has(kind);

// Rows already reported as held this app session. A held row is retried
// on every drain (60s), so report it once, not once a minute.
const reportedHolds = new Set<string>();
let draining = false;
// A drain asked for while one runs (e.g. the quick retry of a critical log
// queued after that drain read the table) runs once it ends.
let rerunRequested = false;

/** Re-reads the queue size for the "saved locally" badge. */
export const refreshPendingWritesCount = async (): Promise<void> => {
  const db = getDatabase();
  if (!db) return;
  const count = await db.collections.get<PendingWriteModel>(TABLE).query().fetchCount();
  useSyncStore.getState().setOutboxCount(count);
};

const retryCriticalSoon = (): void => {
  for (const ms of CRITICAL_RETRY_MS) {
    setTimeout(() => {
      void drainPendingWrites().catch((err) => logError("pendingWrites.criticalRetry", err));
    }, ms);
  }
};

/**
 * Stores a log the server didn't answer for. Resolves `true` once it is on
 * the phone, `false` when it couldn't be stored (no local DB, or the write
 * failed): the caller must then tell the user it was NOT saved.
 */
export const enqueuePendingWrite = async (input: {
  kind: PendingWriteKind;
  payload: PendingWritePayload;
  critical: boolean;
  takenAtIso: string;
}): Promise<boolean> => {
  const db = getDatabase();
  if (!db) return false;
  let added = false;
  try {
    const Q = loadQ();
    const collection = db.collections.get<PendingWriteModel>(TABLE);
    await db.write(async () => {
      const already = await collection
        .query(Q.where("client_uuid", input.payload.clientUuid))
        .fetchCount();
      if (already > 0) return;
      added = true;
      await collection.create((row) => {
        row.clientUuid = input.payload.clientUuid;
        row.userId = input.payload.targetUserId;
        row.kind = input.kind;
        row.payloadJson = JSON.stringify(input.payload);
        row.critical = input.critical;
        row.takenAt = Date.parse(input.takenAtIso);
        row.queuedAt = Date.now();
      });
    });
  } catch (err) {
    // The user is told "not saved", but a lost medical log still goes to
    // Sentry, not just analytics.
    logError("pendingWrites.enqueue", err);
    captureError(err, { where: "pendingWrites.enqueue", kind: input.kind });
    return false;
  }
  // Already queued (a retry of the same log): stored, nothing more to do.
  if (!added) return true;
  track("fail_safe_triggered", { scenario: `${input.kind}_save_offline` });
  if (input.critical) retryCriticalSoon();
  // The badge count is cosmetic: a failure here must not turn a stored log
  // into "not saved".
  await refreshPendingWritesCount().catch((err) => logError("pendingWrites.count", err));
  return true;
};

const reportHold = (row: PendingWriteModel, reason: string, err?: unknown): void => {
  if (reportedHolds.has(row.clientUuid)) return;
  reportedHolds.add(row.clientUuid);
  if (err !== undefined) logError("drainPendingWrites.hold", err);
  if (row.critical) {
    captureError(err ?? new Error(`critical ${row.kind} log held: ${reason}`), {
      where: "drainPendingWrites.holdCritical",
      kind: row.kind,
      reason,
    });
  }
  track("fail_safe_triggered", { scenario: `outbox_hold_${row.kind}_${reason}` });
};

/**
 * Sends every queued log (order and rules above). Called by `useSyncDrain`
 * on app start, reconnect and every 60s; a call while one is running
 * returns at once and the running drain goes round once more.
 */
export const drainPendingWrites = async (): Promise<{
  pushed: number;
  failed: number;
  held: number;
}> => {
  const db = getDatabase();
  if (!db) return { pushed: 0, failed: 0, held: 0 };
  if (draining) {
    rerunRequested = true;
    return { pushed: 0, failed: 0, held: 0 };
  }
  draining = true;
  rerunRequested = false;

  let pushed = 0;
  let failed = 0;
  let held = 0;
  try {
    const Q = loadQ();
    const collection = db.collections.get<PendingWriteModel>(TABLE);
    const pending = await collection.query(Q.sortBy("taken_at", Q.asc)).fetch();
    const ordered = [
      ...pending.filter((r) => r.critical).reverse(),
      ...pending.filter((r) => !r.critical),
    ];
    // Kinds whose endpoint answered 5xx this drain: their rows wait.
    const failingKinds = new Set<string>();

    const remove = async (row: PendingWriteModel): Promise<void> => {
      await db.write(async () => {
        await row.destroyPermanently();
      });
    };

    for (const row of ordered) {
      if (failingKinds.has(row.kind)) {
        held++;
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(row.payloadJson);
      } catch (parseErr) {
        captureError(parseErr, { where: "drainPendingWrites.parse", kind: row.kind });
      }
      if (body === undefined || !isPendingWriteKind(row.kind)) {
        // Never delete what we can't read: keep it for a later app version.
        reportHold(row, "unreadable");
        held++;
        continue;
      }

      try {
        await api.post(ENDPOINTS[row.kind], body);
        await remove(row);
        pushed++;
        continue;
      } catch (err) {
        const status = isAxiosError(err) ? (err.response?.status ?? 0) : 0;
        const code = isAxiosError(err) ? errorCode(err.response?.data) : null;

        if (code !== null && DELIVERED_CODES.has(code)) {
          // The server already has it (a replay whose first answer was lost).
          await remove(row);
          pushed++;
          continue;
        }
        if (code !== null && FEATURE_OFF_CODES.has(code)) {
          reportHold(row, "feature_off");
          held++;
          continue;
        }

        const outcome = classifyDrainFailure(err);
        if (outcome === "drop" && !row.critical) {
          // Refused for good (invalid). A deleted medical log goes to Sentry.
          logError("drainPendingWrites.drop", err);
          captureError(err, { where: "drainPendingWrites.drop", kind: row.kind, status });
          await remove(row);
          track("fail_safe_triggered", { scenario: `outbox_drop_${row.kind}_${status}` });
          failed++;
          continue;
        }
        if (outcome !== "abort") {
          // Keep it and move on, so one row can't block the queue. A
          // critical log is never deleted, even when refused.
          reportHold(row, String(status), err);
          held++;
          continue;
        }
        if (status >= 500 && code !== "MAINTENANCE_MODE") {
          // This endpoint is failing; the others may not be.
          logError("drainPendingWrites.endpoint", err);
          failingKinds.add(row.kind);
          held++;
          continue;
        }
        // No answer, 401, 408, maintenance or the per-minute 429: every row
        // behind this one would get the same answer. The next trigger retries.
        logError("drainPendingWrites", err);
        break;
      }
    }
  } finally {
    draining = false;
    await refreshPendingWritesCount().catch((err) => logError("pendingWrites.count", err));
    if (rerunRequested) {
      rerunRequested = false;
      void drainPendingWrites().catch((err) => logError("pendingWrites.rerun", err));
    }
  }
  return { pushed, failed, held };
};
