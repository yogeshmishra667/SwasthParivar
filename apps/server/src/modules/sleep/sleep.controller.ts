import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import type { SleepCreateBody } from "./sleep.validation.js";
import * as service from "./sleep.service.js";

export const postSleep = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as SleepCreateBody;
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const result = await service.createSleepLog({
    userId,
    date: body.date,
    sleepStart: body.sleepStart,
    sleepEnd: body.sleepEnd,
    durationMinutes: body.durationMinutes,
    quality: body.quality,
    source: body.source,
  });
  ok(res, result, 201);
};

export const getSleep = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { from?: string; to?: string; targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const result = await service.listSleepLogs({
    userId,
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  });
  ok(res, result);
};
