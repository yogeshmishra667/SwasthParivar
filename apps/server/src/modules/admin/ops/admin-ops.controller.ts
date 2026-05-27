import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import { recordAdminAction } from "../../../shared/admin/audit.js";
import * as service from "./admin-ops.service.js";

export const getQueues = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await service.getQueueStats());
};

export const getHealth = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await service.getSystemHealth());
};

export const setMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { enabled } = req.body as { enabled: boolean };
  const admin = req.admin!;
  const result = await service.setMaintenanceMode(enabled, admin.email);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "ops.maintenance_mode",
    targetType: "flag",
    targetId: "maintenance_mode",
    metadata: { enabled },
    ip: req.ip,
  });
  ok(res, result);
};
