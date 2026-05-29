import type { Request, Response } from "express";

import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./schedules.service.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.validation.js";

export const getSchedules = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const schedules = await service.listSchedules(userId);
  ok(res, { schedules });
};

export const postSchedule = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateScheduleInput;
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const schedule = await service.createSchedule(userId, body);
  ok(res, { schedule }, 201);
};

export const putSchedule = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as UpdateScheduleInput;
  const { id } = req.params as { id: string };
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  const schedule = await service.updateSchedule(userId, id, body);
  ok(res, { schedule });
};
