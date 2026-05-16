import type { Request, Response } from "express";

import { ok } from "../../shared/http.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import * as service from "./hba1c.service.js";

export const getEstimate = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const estimate = await service.getHbA1cEstimate({ userId });
  ok(res, { estimate });
};
