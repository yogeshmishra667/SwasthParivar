import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./respiratory.service.js";

export const postRespiratory = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    clientUuid: string;
    peakFlow?: number;
    baselinePeakFlow?: number;
    inhalerUsed: boolean;
    inhalerType?: string;
    puffs?: number;
    triggerNote?: string;
    symptomSeverity: "none" | "mild" | "moderate" | "severe";
    notes?: string;
    source: "manual" | "voice" | "device";
    measuredAt: string;
    version: number;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const { targetUserId: _drop, ...rest } = body;
  void _drop;
  const result = await service.createRespiratoryLog({
    userId,
    ...rest,
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });
  ok(res, result, 201);
};

export const deleteRespiratory = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    throw new DomainError("VALIDATION_ERROR", "id is required");
  }
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  await service.deleteRespiratoryLog({ userId, id });
  ok(res, { deleted: true });
};

export const getRespiratory = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as {
    from?: string;
    to?: string;
    limit?: string | number;
    cursor?: string;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listRespiratoryLogs({
    userId,
    ...(q.from ? { from: new Date(q.from) } : {}),
    ...(q.to ? { to: new Date(q.to) } : {}),
    limit: Number(q.limit ?? 50),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  ok(res, result);
};
