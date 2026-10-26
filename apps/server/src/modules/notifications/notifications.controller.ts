import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import type { NotificationOpenedBody } from "./notifications.validation.js";
import * as service from "./notifications.service.js";

export const postOpened = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as NotificationOpenedBody;
  const userId = await resolveHouseholdMember(req.auth!, body.targetUserId);
  ok(res, await service.recordOpened({ userId, notificationId: body.notificationId }));
};
