import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import type { ActivityCreateBody } from "./activity.validation.js";
import * as service from "./activity.service.js";

export const postActivity = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ActivityCreateBody;
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const result = await service.createActivityDaily({
    userId,
    date: body.date,
    steps: body.steps,
    distanceMeters: body.distanceMeters,
    activeMinutes: body.activeMinutes,
    source: body.source,
  });
  ok(res, result, 201);
};

export const getActivity = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { from?: string; to?: string; targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listActivityDaily({
    userId,
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  });
  ok(res, result);
};
