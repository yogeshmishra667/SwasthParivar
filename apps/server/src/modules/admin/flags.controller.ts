import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import { getFlagOrNull, setFlag, listFlags, getAudit } from "../../shared/flags/index.js";
import { flagKeyParamSchema, setFlagSchema } from "./flags.validation.js";

export const list = async (_req: Request, res: Response): Promise<void> => {
  const flags = await listFlags();
  ok(res, { flags });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const { key } = flagKeyParamSchema.parse(req.params);
  const value = await getFlagOrNull(key);
  ok(res, { key, value });
};

export const set = async (req: Request, res: Response): Promise<void> => {
  const { key } = flagKeyParamSchema.parse(req.params);
  const { value } = setFlagSchema.parse(req.body);
  // `by` is sourced from a header so an operator can identify themselves
  // beyond the shared admin token. Falls back to the requestId so we
  // always have *some* trail in the audit list.
  const by = req.header("x-admin-actor") ?? req.requestId ?? "unknown";
  const prev = await setFlag(key, value, by);
  ok(res, { key, prevValue: prev, newValue: value, by });
};

export const audit = async (req: Request, res: Response): Promise<void> => {
  const { key } = flagKeyParamSchema.parse(req.params);
  const records = await getAudit(key, 20);
  ok(res, { key, records });
};
