import type { Request, Response } from "express";

import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./health-score.service.js";

export const getCurrent = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const score = await service.getHealthScore({ userId });
  ok(res, { score });
};
