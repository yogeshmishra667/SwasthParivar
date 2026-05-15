import { Router, type Request, type Response } from "express";

import { requireAuth } from "../../shared/middleware/auth.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import { ok } from "../../shared/http.js";
import { buildDashboard } from "./dashboard.service.js";

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req: Request, res: Response) => {
  const q = req.query as { targetUserId?: string };
  const userId = await resolveHouseholdMember(req.auth!, q.targetUserId);
  const payload = await buildDashboard({ userId });
  ok(res, payload);
});
