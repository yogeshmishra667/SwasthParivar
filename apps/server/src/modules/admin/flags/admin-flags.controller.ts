import type { Request, Response } from "express";
import { ok } from "../../../shared/http.js";
import { recordAdminAction } from "../../../shared/admin/audit.js";
import type { FlagValue } from "../../../shared/flags/index.js";
import * as service from "./admin-flags.service.js";

export const list = async (_req: Request, res: Response): Promise<void> => {
  ok(res, { flags: await service.listAllFlags() });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  ok(res, { key, value: await service.getFlag(key) });
};

export const audit = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  ok(res, { key, records: await service.getFlagAuditTrail(key) });
};

export const evaluate = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  const { userId } = req.query as unknown as { userId: string };
  ok(res, await service.evaluateFlag(key, userId));
};

export const set = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  const { value } = req.body as { value: FlagValue };
  const admin = req.admin!;
  const result = await service.writeFlag(key, value, admin.email);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "flag.set",
    targetType: "flag",
    targetId: key,
    metadata: { prevValue: result.prevValue, newValue: result.newValue },
    ip: req.ip,
  });
  ok(res, result);
};

export const rollback = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  const admin = req.admin!;
  const result = await service.rollbackFlag(key, admin.email);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "flag.rollback",
    targetType: "flag",
    targetId: key,
    metadata: { from: result.from, rolledBackTo: result.rolledBackTo },
    ip: req.ip,
  });
  ok(res, result);
};

export const patchCohort = async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params as { key: string };
  const { add, remove } = req.body as { add: string[]; remove: string[] };
  const admin = req.admin!;
  const result = await service.patchCohort(key, { add, remove }, admin.email);
  await recordAdminAction({
    adminUserId: admin.id,
    action: "flag.cohort_patch",
    targetType: "flag",
    targetId: key,
    metadata: { add, remove, userIds: result.userIds },
    ip: req.ip,
  });
  ok(res, result);
};
