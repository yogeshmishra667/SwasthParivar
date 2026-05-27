// CSRF protection for /admin/auth — defense in depth on top of the
// existing SameSite=strict refresh cookie + CORS allowlist + bearer-
// token-only data mutations.
//
// THREAT MODEL:
//   The refresh cookie set by `admin-auth.controller` is already
//   `httpOnly` + `sameSite: "strict"` + path-scoped to `/admin/auth`,
//   so browsers won't send it cross-site. Data mutations under
//   /admin/users, /admin/flags, etc. authorize via `Authorization:
//   Bearer` headers — those can't be set by a cross-site form. In
//   practice CSRF is already blocked.
//
//   But CodeQL's `js/missing-csrf-middleware` rule can't reason about
//   SameSite / CORS / header-auth; and a future SameSite policy
//   change would weaken the primary defense. Adding an explicit
//   double-submit token here means: even if SameSite is downgraded,
//   an attacker still needs to read the CSRF cookie (blocked by same-
//   origin policy) to forge a valid request.
//
// LIBRARY CHOICE:
//   `csurf` is on the deprecation track but is the canonical Express
//   CSRF middleware and is the one CodeQL's CSRF query recognizes.
//   The newer `csrf-csrf` is also fine but the rule doesn't see it.
//   The actual primitive (HMAC of a per-session secret) is identical.

import csurf from "csurf";
import type { Request, RequestHandler, Response } from "express";
import { isProd } from "../../../config/env.js";
import { ok } from "../../../shared/http.js";

/**
 * Double-submit CSRF middleware. The server stores a per-session
 * secret in a cookie (`admin_csrf`); each generated token is an HMAC
 * of (secret + salt). State-changing requests must echo a valid
 * token in the `x-csrf-token` header (csurf checks header before
 * body before query).
 */
export const csrfProtection: RequestHandler = csurf({
  cookie: {
    key: "admin_csrf",
    httpOnly: true,
    sameSite: "strict",
    secure: isProd,
    path: "/admin/auth",
  },
});

/**
 * `GET /admin/auth/csrf` — mints a fresh token and sets/refreshes the
 * matching cookie. The client calls this on boot and re-fetches on a
 * 403/ADMIN_CSRF_INVALID retry; idempotent + public.
 */
export const issueCsrfToken = (req: Request, res: Response): void => {
  // csurf decorates `req` with `csrfToken()` once its middleware has
  // run. The type augmentation is in `@types/csurf`.
  ok(res, { csrfToken: req.csrfToken() });
};
