import { DomainError } from "@swasth/shared-types";
import type { SleepLog, SleepQuality, WearableSource } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { isFeatureEnabledFor } from "../../shared/feature-gate.js";
import { startTrustWindowIfUnset } from "../../shared/wearables/trust-window.js";

interface CreateSleepInput {
  userId: string;
  date: string; // YYYY-MM-DD
  sleepStart: string;
  sleepEnd: string;
  durationMinutes: number;
  quality: SleepQuality;
  source: WearableSource;
}

export interface CreateSleepResult {
  sleep: SleepLog;
  /** true when an existing manual row was preserved over a device write. */
  deduped: boolean;
}

const toDateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

export const createSleepLog = async (input: CreateSleepInput): Promise<CreateSleepResult> => {
  const enabled = await isFeatureEnabledFor("sleep_logging_enabled", input.userId);
  if (!enabled) {
    throw new DomainError("SLEEP_DISABLED", "Sleep logging is not enabled.");
  }

  const date = toDateOnly(input.date);

  // Manual-wins dedup, identical rule to ActivityDaily.
  const existing = await prisma.sleepLog.findUnique({
    where: { userId_date: { userId: input.userId, date } },
  });
  if (existing?.source === "manual" && input.source !== "manual") {
    return { sleep: existing, deduped: true };
  }

  const data = {
    sleepStart: new Date(input.sleepStart),
    sleepEnd: new Date(input.sleepEnd),
    durationMinutes: input.durationMinutes,
    quality: input.quality,
    source: input.source,
  };
  const sleep = await prisma.sleepLog.upsert({
    where: { userId_date: { userId: input.userId, date } },
    create: { userId: input.userId, date, ...data },
    update: data,
  });

  if (input.source !== "manual") {
    await startTrustWindowIfUnset(input.userId, new Date());
  }

  return { sleep, deduped: false };
};

export const listSleepLogs = async (params: {
  userId: string;
  from?: string;
  to?: string;
}): Promise<{ data: SleepLog[] }> => {
  const data = await prisma.sleepLog.findMany({
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
