// Auth wrapper for the Bull-board UI (mounted at /admin/queues).
//
// The main admin router uses `Authorization: Bearer <jwt>` headers
// because every admin call is XHR/fetch from the SPA — the browser
// can attach the header itself. Bull-board is a *browser navigation*
// surface: the user clicks a button that opens `/admin/queues?token=…`
// in a new tab, and the browser cannot attach an Authorization header
// to a navigation. So this guard accepts the token via:
//   1. `?token=…` query param (the initial navigation)
//   2. `bb_session` cookie (everything after the initial nav)
//
// On (1) we verify the token, set the cookie scoped to /admin/queues,
// and redirect to the same URL minus the query param so the JWT does
// not leak into the URL bar / browser history / bull-board's own
// internal links. On (2) we just verify and continue.
//
// The cookie is HttpOnly + Secure (in prod) + Path=/admin/queues so
// it never reaches any other surface — CodeQL's "data admin routes
// are cookie-free" guarantee for the main router is preserved.
//
// Only super_admin + ops can open bull-board. A `support` admin gets
// 403 ADMIN_FORBIDDEN — same RBAC as the Ops page itself.

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { DomainError } from "@swasth/shared-types";
import { env, isProd } from "../../config/env.js";
import { prisma } from "../database.js";

interface AdminAccessClaims {
  sub: string;
  type: "admin_access";
}

const BB_COOKIE_NAME = "bb_session";
const BB_COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1h — matches admin access token TTL

const ALLOWED_ROLES = new Set(["super_admin", "ops"]);

// Light cookie parser — we cannot mount `cookie-parser` globally on
// /admin without breaking the "cookie-free data routes" invariant the
// main admin router was designed around. This pulls just `bb_session`
// out of the raw header.
const readBbCookie = (req: Request): string | null => {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === BB_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
};

export const requireBullBoardAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const secret = env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new DomainError("ADMIN_FORBIDDEN", "admin console disabled — ADMIN_JWT_SECRET unset");
  }

  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const cookieToken = readBbCookie(req);
  const token = queryToken ?? cookieToken;

  if (!token) {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "missing admin token");
  }

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
  if (!ALLOWED_ROLES.has(admin.role)) {
    throw new DomainError("ADMIN_FORBIDDEN", "insufficient role for queue dashboard");
  }

  // If the token came from `?token=…`, persist it as a path-scoped
  // cookie and redirect to drop the JWT from the URL.
  if (queryToken !== null) {
    res.cookie(BB_COOKIE_NAME, queryToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/admin/queues",
      maxAge: BB_COOKIE_MAX_AGE_SECONDS * 1000,
    });
    // Strip the token from the URL so it doesn't sit in browser history
    // or bull-board's own navigation links. `req.baseUrl + req.path`
    // gives us the absolute path including the mount prefix
    // (/admin/queues) — `req.path` alone is router-relative.
    const { token: _drop, ...rest } = req.query as Record<string, unknown>;
    const qs = new URLSearchParams(rest as Record<string, string>).toString();
    const target = req.baseUrl + req.path + (qs ? `?${qs}` : "");
    res.redirect(target);
    return;
  }

  req.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  next();
};
