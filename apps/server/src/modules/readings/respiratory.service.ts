import { DomainError } from "@swasth/shared-types";
import { classifyRespiratoryReading, planMultiCategoryBypassDispatch } from "@swasth/domain-logic";
import { Prisma, type RespiratoryLog } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import { logger } from "../../shared/logger.js";
import { createQueue, QUEUE_NAMES } from "../../shared/queue.js";
import { checkIdempotent } from "../../shared/idempotency.js";
import { getFlag } from "../../shared/flags/index.js";
import { getLastBypassIso, markBypassed } from "../../shared/critical-bypass-cooldown.js";
import type {
  CriticalAlertJob,
  CriticalAlertMultiCategoryJob,
} from "../../workers/critical-alert.processor.js";

const criticalQueue = createQueue<CriticalAlertJob>(QUEUE_NAMES.CRITICAL_ALERT);

interface CreateRespiratoryInput {
  userId: string;
  clientUuid: string;
  peakFlow?: number | undefined;
  /**
   * Optional caller-supplied baseline. When omitted, the service
   * snapshots the user's stored baseline so the row is self-describing
   * (a baseline change on the User row never retroactively re-
   * classifies a historical log).
   */
  baselinePeakFlow?: number | undefined;
  inhalerUsed: boolean;
  inhalerType?: string | undefined;
  puffs?: number | undefined;
  triggerNote?: string | undefined;
  symptomSeverity: "none" | "mild" | "moderate" | "severe";
  notes?: string | undefined;
  source: "manual" | "voice" | "device";
  measuredAt: string;
  version: number;
  requestId?: string;
}

export interface CreateRespiratoryResult {
  reading: RespiratoryLog;
  critical: {
    isCritical: boolean;
    primaryReason: string;
    withinCooldown: boolean;
  };
}

const buildReplayResult = (reading: RespiratoryLog): CreateRespiratoryResult => {
  const classification = classifyRespiratoryReading({
    peakFlow: reading.peakFlow,
    baselinePeakFlow: reading.baselinePeakFlow,
    inhalerUsed: reading.inhalerUsed,
    symptomSeverity: reading.symptomSeverity,
  });
  return {
    reading,
    critical: {
      isCritical: classification.severity === "critical_bypass",
      primaryReason: classification.reason,
      withinCooldown: false,
    },
  };
};

export const createRespiratoryLog = async (
  input: CreateRespiratoryInput,
): Promise<CreateRespiratoryResult> => {
  const enabled = await getFlag<boolean>("respiratory_logging_enabled", false);
  if (!enabled) {
    throw new DomainError(
      "RESPIRATORY_DISABLED",
      "Respiratory logging is currently unavailable. Try again later.",
    );
  }

  const idem = await checkIdempotent(prisma.respiratoryLog, input.clientUuid, input.version);
  if (idem.kind === "stale") {
    throw new DomainError("READING_STALE_VERSION", "incoming version not newer than stored");
  }
  if (idem.kind === "replay") {
    return buildReplayResult(idem.existing);
  }
  const existing = idem.kind === "update" ? idem.existing : null;

  await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  // Baseline snapshot. The Phase 4 baseline lives on `User` and gains
  // its own update endpoint in Feature I (wearables); until then, an
  // explicit `baselinePeakFlow` on the request wins. Stored on the
  // log row so reclassification cannot drift if the user later
  // updates their personal-best.
  const baselineForClassifier = input.baselinePeakFlow ?? null;

  const classification = classifyRespiratoryReading({
    peakFlow: input.peakFlow ?? null,
    baselinePeakFlow: baselineForClassifier,
    inhalerUsed: input.inhalerUsed,
    symptomSeverity: input.symptomSeverity,
  });

  let reading: RespiratoryLog;
  if (existing) {
    reading = await prisma.respiratoryLog.update({
      where: {
        clientUuid_measuredAt: {
          clientUuid: existing.clientUuid,
          measuredAt: existing.measuredAt,
        },
      },
      data: {
        ...(input.peakFlow !== undefined ? { peakFlow: input.peakFlow } : { peakFlow: null }),
        ...(input.baselinePeakFlow !== undefined
          ? { baselinePeakFlow: input.baselinePeakFlow }
          : {}),
        inhalerUsed: input.inhalerUsed,
        ...(input.inhalerType !== undefined ? { inhalerType: input.inhalerType } : {}),
        ...(input.puffs !== undefined ? { puffs: input.puffs } : {}),
        ...(input.triggerNote !== undefined ? { triggerNote: input.triggerNote } : {}),
        symptomSeverity: input.symptomSeverity,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        source: input.source,
        version: input.version,
      },
    });
  } else {
    try {
      reading = await prisma.respiratoryLog.create({
        data: {
          clientUuid: input.clientUuid,
          ...(input.peakFlow !== undefined ? { peakFlow: input.peakFlow } : {}),
          ...(input.baselinePeakFlow !== undefined
            ? { baselinePeakFlow: input.baselinePeakFlow }
            : {}),
          inhalerUsed: input.inhalerUsed,
          ...(input.inhalerType !== undefined ? { inhalerType: input.inhalerType } : {}),
          ...(input.puffs !== undefined ? { puffs: input.puffs } : {}),
          ...(input.triggerNote !== undefined ? { triggerNote: input.triggerNote } : {}),
          symptomSeverity: input.symptomSeverity,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          source: input.source,
          measuredAt: new Date(input.measuredAt),
          version: input.version,
          user: { connect: { id: input.userId } },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.respiratoryLog.findFirst({
          where: { clientUuid: input.clientUuid },
        });
        if (winner) {
          logger.info(
            { clientUuid: input.clientUuid, userId: input.userId },
            "respiratory concurrent create resolved as idempotent replay",
          );
          return buildReplayResult(winner);
        }
      }
      throw err;
    }
  }

  let withinCooldown = false;
  if (classification.severity === "critical_bypass") {
    const lastBypassIso = await getLastBypassIso("respiratory", input.userId);
    const contacts = await prisma.emergencyContact.findMany({
      where: { userId: input.userId },
      orderBy: { priority: "asc" },
      select: { id: true, priority: true, isGuardian: true },
    });
    const dispatch = planMultiCategoryBypassDispatch({
      category: "respiratory",
      reasons: classification.reasons,
      nowIso: new Date().toISOString(),
      lastBypassTriggeredAtIso: lastBypassIso,
      emergencyContacts: contacts.map((c) => ({
        contactId: c.id,
        priority: c.priority,
        isGuardian: c.isGuardian,
      })),
    });
    withinCooldown = dispatch.withinCooldown;
    if (!dispatch.withinCooldown) {
      const job: CriticalAlertMultiCategoryJob = {
        category: "respiratory",
        readingId: reading.id,
        userId: input.userId,
        dispatch,
        copyParams: {
          ...(reading.peakFlow !== null ? { peakFlow: reading.peakFlow } : {}),
          ...(reading.baselinePeakFlow !== null
            ? { baselinePeakFlow: reading.baselinePeakFlow }
            : {}),
        },
        ...(input.requestId ? { requestId: input.requestId } : {}),
      };
      await criticalQueue.add("dispatch", job);
      await markBypassed("respiratory", input.userId, new Date().toISOString());
    }
  }

  return {
    reading,
    critical: {
      isCritical: classification.severity === "critical_bypass",
      primaryReason: classification.reason,
      withinCooldown,
    },
  };
};

export const deleteRespiratoryLog = async (params: {
  userId: string;
  id: string;
}): Promise<void> => {
  const existing = await prisma.respiratoryLog.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) {
    throw new DomainError("READING_NOT_FOUND", "respiratory log does not exist");
  }
  await prisma.respiratoryLog.delete({
    where: {
      clientUuid_measuredAt: {
        clientUuid: existing.clientUuid,
        measuredAt: existing.measuredAt,
      },
    },
  });
};

export const listRespiratoryLogs = async (params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}): Promise<{ data: RespiratoryLog[]; cursor: string | null; hasMore: boolean }> => {
  const where: Prisma.RespiratoryLogWhereInput = {
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

  const rows = await prisma.respiratoryLog.findMany({
    where,
    orderBy: { measuredAt: "desc" },
    take: params.limit + 1,
    ...cursorClause,
  });

  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  const cursor = hasMore && last ? `${last.clientUuid}_${last.measuredAt.toISOString()}` : null;
  return { data, cursor, hasMore };
};
