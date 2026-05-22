// Admin feature-flag control plane. Wraps the shared Redis flag service
// (shared/flags) and the CC.12 rollout resolver (shared/rollout) with the
// operations the console needs: list, read, write, audit trail, one-click
// rollback, rollout preview, and atomic cohort edits.
//
// The shared flag service keeps its own per-flag audit list in Redis
// (shown as the flag timeline). The unified admin audit log in Postgres
// is written separately by the controller via recordAdminAction.

import { DomainError } from "@swasth/shared-types";
import {
  getAudit,
  getFlagOrNull,
  listFlags,
  setFlag,
  type FlagValue,
} from "../../../shared/flags/index.js";
import { computeBucket, isFeatureEnabled } from "../../../shared/rollout.js";

export const listAllFlags = async (): Promise<Record<string, FlagValue>> => await listFlags();

export const getFlag = async (key: string): Promise<FlagValue | null> => await getFlagOrNull(key);

/** Per-flag change history (newest first), from the Redis flag audit list. */
export const getFlagAuditTrail = async (
  key: string,
): Promise<Awaited<ReturnType<typeof getAudit>>> => await getAudit(key, 50);

export interface FlagWriteResult {
  key: string;
  prevValue: FlagValue | null;
  newValue: FlagValue;
}

export const writeFlag = async (
  key: string,
  value: FlagValue,
  by: string,
): Promise<FlagWriteResult> => {
  const prevValue = await setFlag(key, value, by);
  return { key, prevValue, newValue: value };
};

export interface FlagRollbackResult {
  key: string;
  from: FlagValue;
  rolledBackTo: FlagValue;
}

/**
 * Revert a flag to the value it held before its most recent change.
 * The flag audit list stores `prevValue` on every record, so rollback is
 * a single setFlag to that prior value.
 */
export const rollbackFlag = async (key: string, by: string): Promise<FlagRollbackResult> => {
  const [last] = await getAudit(key, 1);
  if (!last) {
    throw new DomainError("VALIDATION_ERROR", `flag '${key}' has no change history to roll back`);
  }
  if (last.prevValue === null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `flag '${key}' had no value before its first change — set it explicitly instead`,
    );
  }
  await setFlag(key, last.prevValue, by);
  return { key, from: last.newValue, rolledBackTo: last.prevValue };
};

export interface FlagEvaluation {
  key: string;
  userId: string;
  /** Resolved on/off for this user via the CC.12 rollout gate. */
  enabled: boolean;
  /** Deterministic 0–99 rollout bucket for (key, userId). */
  bucket: number;
  /** Raw flag value, for the console to show alongside the verdict. */
  value: FlagValue | null;
}

/** Rollout preview — "is this flag ON for user X, and why". */
export const evaluateFlag = async (key: string, userId: string): Promise<FlagEvaluation> => {
  const [enabled, value] = await Promise.all([isFeatureEnabled(key, userId), getFlagOrNull(key)]);
  return { key, userId, enabled, bucket: computeBucket(key, userId), value };
};

export interface CohortPatchResult {
  key: string;
  userIds: string[];
}

/**
 * Add/remove user ids from a cohort flag atomically (read-modify-write on
 * the server, not the client). Works on `cohort` and `cohort_or_percentage`
 * flags, and creates a fresh `cohort` flag when the key is unset.
 */
export const patchCohort = async (
  key: string,
  changes: { add: string[]; remove: string[] },
  by: string,
): Promise<CohortPatchResult> => {
  const current = await getFlagOrNull(key);

  let userIds: string[] = [];
  let rollout: "cohort" | "cohort_or_percentage" = "cohort";
  let percent = 0;

  if (current !== null) {
    const isCohortObject =
      typeof current === "object" &&
      !Array.isArray(current) &&
      (current.rollout === "cohort" || current.rollout === "cohort_or_percentage");
    if (!isCohortObject) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `flag '${key}' is not a cohort flag — cohort edits need a cohort or cohort_or_percentage flag`,
      );
    }
    rollout = current.rollout as "cohort" | "cohort_or_percentage";
    userIds = Array.isArray(current.userIds)
      ? current.userIds.filter((id): id is string => typeof id === "string")
      : [];
    if (rollout === "cohort_or_percentage" && typeof current.percent === "number") {
      percent = current.percent;
    }
  }

  const next = new Set(userIds);
  for (const id of changes.add) next.add(id);
  for (const id of changes.remove) next.delete(id);
  const userIdsNext = [...next];

  const value: FlagValue =
    rollout === "cohort_or_percentage"
      ? { rollout: "cohort_or_percentage", userIds: userIdsNext, percent }
      : { rollout: "cohort", userIds: userIdsNext };

  await setFlag(key, value, by);
  return { key, userIds: userIdsNext };
};
