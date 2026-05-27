import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { DomainError, type AdminRole } from "@swasth/shared-types";
import { env } from "../../config/env.js";
import { prisma } from "../database.js";

// Admin access-token payload. `type` discriminates the access token from
// the short-lived TOTP challenge token and the refresh token, so a token
// minted for one stage cannot be replayed at another.
interface AdminAccessClaims {
  sub: string;
  type: "admin_access";
}

/**
 * Guards every /admin route except the login / refresh endpoints. Verifies
 * the admin access JWT, then loads the AdminUser fresh from the database
 * so a deactivation or role change takes effect immediately — the token
 * alone is never trusted for `active` / `role`. Admin traffic is low, so
 * the per-request lookup is a deliberate correctness-over-speed choice.
 */
export const requireAdminAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const secret = env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new DomainError("ADMIN_FORBIDDEN", "admin console disabled — ADMIN_JWT_SECRET unset");
  }

  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "missing admin token");

  let claims: AdminAccessClaims;
  try {
    claims = jwt.verify(token, secret) as AdminAccessClaims;
  } catch {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "invalid or expired admin token");
  }
  if (claims.type !== "admin_access") {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "wrong admin token type");
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: claims.sub } });
  if (!admin) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "admin account not found");
  if (!admin.active) throw new DomainError("ADMIN_ACCOUNT_DISABLED", "admin account is disabled");

  req.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  next();
};

/**
 * Restricts a route to a set of roles. Must be mounted after
 * `requireAdminAuth`. Throws ADMIN_FORBIDDEN (403) when the caller's role
 * is not in the allowed set.
 */
export const requireAdminRole =
  (...roles: AdminRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      throw new DomainError("ADMIN_INVALID_CREDENTIALS", "admin auth required");
    }
    if (!roles.includes(req.admin.role)) {
      throw new DomainError("ADMIN_FORBIDDEN", "insufficient role for this action");
    }
    next();
  };
