import type { NextFunction, Request, Response } from "express";
import { requireHouseholdPrimary } from "../auth/household.js";

/**
 * Express middleware that rejects any caller who is not the household
 * primary. Used on guardian-side family routes and household-admin
 * writes so the "guardian = primary account only" invariant from
 * CLAUDE.md is enforced at the edge, not just by the mobile UI.
 *
 * Today every JWT belongs to a primary, so this is defense in depth.
 * It exists so that any future auth refactor that grants sub-profiles
 * tokens cannot silently widen the guardian surface.
 */
export const requirePrimary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  await requireHouseholdPrimary(req.auth!);
  next();
};
