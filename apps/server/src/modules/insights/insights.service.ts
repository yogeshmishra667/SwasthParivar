import { DomainError } from "@swasth/shared-types";
import type {
  InsightEvent,
  InsightPatternType,
  InsightSeverityLevel,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { INSIGHT_CONFIDENCE_FLOOR } from "@swasth/shared-types";

export const listInsights = async (params: {
  userId: string;
  severity?: InsightSeverityLevel;
  acknowledged?: boolean;
  patternType?: InsightPatternType;
  limit: number;
  cursor?: string;
}): Promise<{ data: InsightEvent[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.InsightEventWhereInput = {
    userId: params.userId,
    // Low-confidence insights are stored for analytics review but never
    // surfaced to the patient. The mobile feed should never see them.
    confidence: { gte: INSIGHT_CONFIDENCE_FLOOR },
    ...(params.severity ? { severityLevel: params.severity } : {}),
    ...(params.acknowledged !== undefined ? { acknowledged: params.acknowledged } : {}),
    ...(params.patternType ? { patternType: params.patternType } : {}),
  };

  // Cursor format mirrors other reading lists: `${id}_${createdAtIso}`.
  const cursorClause = params.cursor
    ? (() => {
        const parts = params.cursor.split("_");
        const id = parts[0];
        const createdAt = parts[1];
        if (!id || !createdAt) {
          throw new DomainError("VALIDATION_ERROR", "malformed cursor");
        }
        return {
          skip: 1,
          cursor: { id_createdAt: { id, createdAt: new Date(createdAt) } },
        };
      })()
    : {};

  const rows = await prisma.insightEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: params.limit + 1,
    ...cursorClause,
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor =
    hasMore && last ? `${last.id}_${last.createdAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};

export const acknowledgeInsight = async (params: {
  userId: string;
  id: string;
  helpful?: boolean | undefined;
}): Promise<InsightEvent> => {
  // Ownership check first — never let user A flip user B's flags.
  const existing = await prisma.insightEvent.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("INSIGHT_NOT_FOUND", "insight does not exist");
  }
  return await prisma.insightEvent.update({
    where: { id_createdAt: { id: existing.id, createdAt: existing.createdAt } },
    data: {
      acknowledged: true,
      ...(params.helpful !== undefined ? { helpful: params.helpful } : {}),
    },
  });
};
