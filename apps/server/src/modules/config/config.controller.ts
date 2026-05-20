/**
 * Phase 3 — Feature config endpoint (controller) — phase3.md CC.12.4.
 *
 * Thin Express handler. No body/query to validate; resolves the
 * feature map for the authenticated caller and wraps it in the
 * standard `{success, data}` envelope.
 */

import type { Request, Response } from "express";
import { ok } from "../../shared/http.js";
import * as service from "./config.service.js";

export const getFeatures = async (req: Request, res: Response): Promise<void> => {
  const result = await service.resolveFeatures(req.auth!.sub);
  ok(res, result);
};
