import type { Request, Response } from "express";
import type { AdminRole } from "@swasth/shared-types";
import { ok } from "../../../shared/http.js";
import { recordAdminAction } from "../../../shared/admin/audit.js";
import * as service from "./admin-admins.service.js";

export const list = async (_req: Request, res: Response): Promise<void> => {
  ok(res, { admins: await service.listAdmins() });
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { email: string; name: string; role: AdminRole; password: string };
  const admin = req.admin!;
  const created = await service.createAdmin(body);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "admin.created",
    targetType: "admin_user",
    targetId: created.id,
    metadata: { email: created.email, role: created.role },
    ip: req.ip,
  });
  ok(res, created, 201);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const body = req.body as { role?: AdminRole; active?: boolean };
  const admin = req.admin!;
  const updated = await service.updateAdmin({
    id,
    actorId: admin.id,
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  });
  await recordAdminAction({
    adminUserId: admin.id,
    action: "admin.updated",
    targetType: "admin_user",
    targetId: id,
    metadata: { ...body },
    ip: req.ip,
  });
  ok(res, updated);
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { password } = req.body as { password: string };
  const admin = req.admin!;
  const result = await service.resetAdminPassword(id, password);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "admin.password_reset",
    targetType: "admin_user",
    targetId: id,
    ip: req.ip,
  });
  ok(res, result);
};
