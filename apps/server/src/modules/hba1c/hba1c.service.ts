// HbA1c module — wraps the pure `estimateHbA1c` from @swasth/domain-logic
// with the Prisma read + Redis cache. The math itself stays in the
// domain package; this file only handles I/O.
//
// Caching strategy (CLAUDE.md "Caching (Redis)"): 1 hour TTL, keyed by
// user. Cached payload is JSON-serialised `HbA1cEstimate`. The cache is
// best-effort — a Redis miss/error returns a fresh computation rather
// than failing the request.

import { DomainError } from "@swasth/shared-types";
import { estimateHbA1c, type HbA1cEstimate } from "@swasth/domain-logic";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { redis } from "../../shared/redis.js";

// Re-export the domain types so the controller pulls them from this
// boundary file (single import line per module).
export type { HbA1cEstimate };

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const READING_LOOKBACK_DAYS = 90;
const dayMs = 86_400_000;

const cacheKey = (userId: string): string => `hba1c:${userId}`;

export interface GetHbA1cInput {
  userId: string;
}

export const getHbA1cEstimate = async (input: GetHbA1cInput): Promise<HbA1cEstimate> => {
  const key = cacheKey(input.userId);

  // Cache read — best-effort.
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as HbA1cEstimate;
    }
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "hba1c cache read failed — falling through");
  }

  const cutoff = new Date(Date.now() - READING_LOOKBACK_DAYS * dayMs);
  const readings = await prisma.glucoseReading.findMany({
    where: { userId: input.userId, measuredAt: { gte: cutoff } },
    select: { valueMgDl: true, measuredAt: true },
    orderBy: { measuredAt: "desc" },
  });

  const result = estimateHbA1c({
    readings: readings.map((r) => ({
      valueMgDl: r.valueMgDl,
      measuredAt: r.measuredAt.toISOString(),
    })),
    now: new Date(),
  });

  if (result === null) {
    throw new DomainError(
      "INSUFFICIENT_DATA",
      "Need at least 30 glucose readings in the last 90 days with at least one in the past month before we can estimate HbA1c.",
    );
  }

  // Cache write — best-effort. EX = 1 hour.
  try {
    await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "hba1c cache write failed");
  }

  return result;
};
