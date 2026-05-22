import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import * as service from "./admin-analytics.service.js";

export const overview = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await service.getOverview());
};

export const metric = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  ok(res, await service.getMetric(key));
};
