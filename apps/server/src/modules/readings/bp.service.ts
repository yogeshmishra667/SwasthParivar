import { DomainError } from "@swasth/shared-types";
import type { BPReading, Prisma } from "@prisma/client";
import { prisma } from "../../shared/database.js";

interface CreateBPInput {
  userId: string;
  clientUuid: string;
  systolic: number;
  diastolic: number;
  pulse?: number | undefined;
  context: "normal" | "festive";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  version: number;
}

export interface CreateBPResult {
  reading: BPReading;
}

export const createBPReading = async (input: CreateBPInput): Promise<CreateBPResult> => {
  const existing = await prisma.bPReading.findFirst({
    where: { clientUuid: input.clientUuid },
  });

  if (existing && input.version <= existing.version) {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }

  // Ownership check: the user row must exist (Prisma FK enforces this on
  // create, but we surface a cleaner error if the JWT references a deleted
  // user).
  await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // The update path deliberately preserves the existing measured_at
  // because it is the TimescaleDB hypertable partition key. The
  // user-facing edit flow updates value / notes — not the medical
  // timestamp. Anything that would shift measured_at goes through
  // DELETE + create.
  const reading = existing
    ? await prisma.bPReading.update({
        where: {
          clientUuid_measuredAt: {
            clientUuid: existing.clientUuid,
            measuredAt: existing.measuredAt,
          },
        },
        data: {
          systolic: input.systolic,
          diastolic: input.diastolic,
          ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
          context: input.context,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          version: input.version,
        },
      })
    : await prisma.bPReading.create({
        data: {
          clientUuid: input.clientUuid,
          systolic: input.systolic,
          diastolic: input.diastolic,
          ...(input.pulse !== undefined ? { pulse: input.pulse } : {}),
          context: input.context,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          measuredAt: new Date(input.measuredAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });

  return { reading };
};

export const deleteBPReading = async (params: {
  userId: string;
  id: string;
}): Promise<void> => {
  const existing = await prisma.bPReading.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "reading does not exist");
  }
  await prisma.bPReading.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listBPReadings = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: BPReading[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.BPReadingWhereInput = {
    userId: params.userId,
    ...(params.from || params.to
      ? {
          measuredAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
  };

  // Cursor format: `${clientUuid}_${measuredAtIso}` — same as glucose. The
  // composite cursor is required because the hypertable's primary key is
  // (id, measured_at); the (clientUuid, measuredAt) unique index is what
  // Prisma exposes as a cursor anchor.
  const cursorClause = params.cursor
    ? (() => {
        const parts = params.cursor.split("_");
        const cuid = parts[0];
        const measuredAt = parts[1];
        if (!cuid || !measuredAt) {
          throw new DomainError("VALIDATION_ERROR", "malformed cursor");
        }
        return {
          skip: 1,
          cursor: {
            clientUuid_measuredAt: {
              clientUuid: cuid,
              measuredAt: new Date(measuredAt),
            },
          },
        };
      })()
    : {};

  const rows = await prisma.bPReading.findMany({
    where,
    orderBy: { measuredAt: "desc" },
    take: params.limit + 1,
    ...cursorClause,
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor =
    hasMore && last ? `${last.clientUuid}_${last.measuredAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
