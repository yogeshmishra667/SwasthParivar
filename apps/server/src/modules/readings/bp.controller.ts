import type { Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./bp.service.js";

export const postBP = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    clientUuid: string;
    systolic: number;
    diastolic: number;
    pulse?: number;
    context: "normal" | "festive";
    notes?: string;
    source: "manual" | "voice" | "device";
    measuredAt: string;
    version: number;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const { targetUserId: _drop, ...rest } = body;
  void _drop;
  const result = await service.createBPReading({ userId, ...rest });
  ok(res, result, 201);
};

export const deleteBP = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || typeof id !== "string") throw new DomainError("VALIDATION_ERROR", "id is required");
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  await service.deleteBPReading({ userId, id });
  ok(res, { deleted: true });
};

export const getBP = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as {
    from?: string;
    to?: string;
    limit?: string | number;
    cursor?: string;
    targetUserId?: string;
  };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listBPReadings({
    userId,
    ...(q.from ? { from: new Date(q.from) } : {}),
    ...(q.to ? { to: new Date(q.to) } : {}),
    limit: Number(q.limit ?? 50),
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });
  ok(res, result);
};
