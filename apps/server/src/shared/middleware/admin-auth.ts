import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { DomainError } from "@swasth/shared-types";
import { env } from "../../config/env.js";

const constantTimeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    // Hash-pad to dodge length-based timing leak on the early-exit path.
    // We still return false; the timingSafeEqual call just balances cost.
    const ab = Buffer.from(a);
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Guards /admin routes. Requires `Authorization: Bearer <ADMIN_API_TOKEN>`.
 * The token is required in production (see env.ts PROD_REQUIRED_KEYS);
 * in dev/test, the absence of the env var causes every request to be
 * rejected as well — preventing an accidental "no auth in dev" leak.
 */
export const adminAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = env.ADMIN_API_TOKEN;
  if (!expected) {
    throw new DomainError("AUTH_UNAUTHORIZED", "admin endpoints disabled — ADMIN_API_TOKEN unset");
  }
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new DomainError("AUTH_UNAUTHORIZED", "missing admin token");
  }
  const presented = header.slice("Bearer ".length).trim();
  if (!constantTimeEquals(presented, expected)) {
    throw new DomainError("AUTH_UNAUTHORIZED", "invalid admin token");
  }
  next();
};
