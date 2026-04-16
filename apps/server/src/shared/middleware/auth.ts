import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { DomainError } from "@swasth/shared-types";
import { env } from "../../config/env.js";

export interface AuthClaims {
  sub: string;
  householdId: string;
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new DomainError("AUTH_UNAUTHORIZED", "missing bearer token");

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthClaims;
    req.auth = payload;
    next();
  } catch {
    throw new DomainError("AUTH_TOKEN_EXPIRED", "invalid or expired token");
  }
};
