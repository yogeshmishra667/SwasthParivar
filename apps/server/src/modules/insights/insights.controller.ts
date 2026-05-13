import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import type { InsightPatternType, InsightSeverityLevel } from "@prisma/client";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./insights.service.js";

export const getInsights = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as {
    severity?: InsightSeverityLevel;
    acknowledged?: boolean;
    patternType?: InsightPatternType;
    limit?: string | number;
    cursor?: string;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listInsights({
    userId,
    ...(q.severity ? { severity: q.severity } : {}),
    ...(q.acknowledged !== undefined ? { acknowledged: String(q.acknowledged) === "true" } : {}),
    ...(q.patternType ? { patternType: q.patternType } : {}),
    limit: Number(q.limit ?? 50),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  ok(res, result);
};

export const postAcknowledge = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") throw new DomainError("VALIDATION_ERROR", "id is required");
  const body = req.body as { helpful?: boolean };
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const insight = await service.acknowledgeInsight({
    userId,
    id,
    ...(body.helpful !== undefined ? { helpful: body.helpful } : {}),
  });
  ok(res, { insight });
};
