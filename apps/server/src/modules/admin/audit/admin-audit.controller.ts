import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import * as service from "./admin-audit.service.js";

export const list = async (req: Request, res: Response): Promise<void> => {
  const query = req.query as unknown as {
    action?: string;
    adminUserId?: string;
    limit: number;
    offset: number;
  };
  ok(res, await service.listAuditLog(query));
};
