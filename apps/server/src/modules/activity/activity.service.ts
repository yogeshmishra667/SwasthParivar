import { DomainError } from "@swasth/shared-types";
import type { ActivityDaily, WearableSource } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { isFeatureEnabledFor } from "../../shared/feature-gate.js";
import { startTrustWindowIfUnset } from "../../shared/wearables/trust-window.js";

interface CreateActivityInput {
  userId: string;
  date: string; // YYYY-MM-DD
  steps: number;
  distanceMeters: number;
  activeMinutes: number;
  source: WearableSource;
}

export interface CreateActivityResult {
  activity: ActivityDaily;
  /** true when an existing manual row was preserved over a device write. */
  deduped: boolean;
}

// Parse a YYYY-MM-DD into the UTC midnight instant Postgres stores for a
// DATE column, so round-tripping the value is stable regardless of the
// server's local zone.
const toDateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

export const createActivityDaily = async (
  input: CreateActivityInput,
): Promise<CreateActivityResult> => {
  const enabled = await isFeatureEnabledFor("activity_logging_enabled", input.userId);
  if (!enabled) {
    throw new DomainError("ACTIVITY_DISABLED", "Activity logging is not enabled.");
  }

  const date = toDateOnly(input.date);

  // Manual-wins: a device sync must never clobber a manual entry for the
  // same day (CLAUDE.md "manual entry for same userId+date wins"). The
  // reverse — manual overwriting device, or like-source refresh — is
  // allowed and flows through the upsert.
  const existing = await prisma.activityDaily.findUnique({
    where: { userId_date: { userId: input.userId, date } },
  });
  if (existing?.source === "manual" && input.source !== "manual") {
    return { activity: existing, deduped: true };
  }

  const data = {
    steps: input.steps,
    distanceMeters: input.distanceMeters,
    activeMinutes: input.activeMinutes,
    source: input.source,
  };
  const activity = await prisma.activityDaily.upsert({
    where: { userId_date: { userId: input.userId, date } },
    create: { userId: input.userId, date, ...data },
    update: data,
  });

  // First device-sourced row starts the 30-day trust countdown (NX).
  if (input.source !== "manual") {
    await startTrustWindowIfUnset(input.userId, new Date());
  }

  return { activity, deduped: false };
};

export const listActivityDaily = async (params: {
  userId: string;
  from?: string;
  to?: string;
}): Promise<{ data: ActivityDaily[] }> => {
  const data = await prisma.activityDaily.findMany({
    where: {
      userId: params.userId,
      ...(params.from || params.to
        ? {
            date: {
              ...(params.from ? { gte: toDateOnly(params.from) } : {}),
              ...(params.to ? { lte: toDateOnly(params.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
  });
  return { data };
};
