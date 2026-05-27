// CSRF protection for /admin/auth (double-submit cookie pattern via
// `csrf-csrf`).
//
// THREAT MODEL & WHY THIS EXISTS:
//   The refresh cookie minted by `admin-auth.controller.setRefreshCookie`
//   is already heavily protected: `httpOnly` + `sameSite: "strict"`
//   means the browser will not send it on a cross-site request at all,
//   the path is scoped to `/admin/auth`, and the CORS allowlist in
//   `app.ts` rejects unknown origins. Mutating data endpoints
//   (/admin/users, /admin/flags, …) authorize via `Authorization:
//   Bearer` headers — those cannot be set cross-site without CORS.
//
//   In other words: real-world CSRF against this surface is already
//   blocked. But CodeQL's `js/missing-csrf-middleware` rule cannot
//   reason about SameSite / CORS / bearer-only-mutations, and a future
//   browser change to SameSite defaults could weaken the primary
//   defense. Adding an explicit double-submit token is defense in
//   depth: even if SameSite is downgraded, an attacker still needs to
//   read the token cookie (blocked by the same-origin policy) to
//   forge a valid request.

import { doubleCsrf } from "csrf-csrf";
import type { Request, Response } from "express";
import { env, isProd } from "../../../config/env.js";
import { ok } from "../../../shared/http.js";

// csrf-csrf requires a secret even on the dev path. env.ts forces a
// real ≥32-char secret in production via PROD_REQUIRED_KEYS; this
// fallback only runs in dev/test where a misconfigured secret is not
// a security boundary.
const CSRF_SECRET =
  env.ADMIN_CSRF_SECRET ?? "dev-only-admin-csrf-secret-not-for-production-use-1234567890";

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  cookieName: "admin_csrf",
  cookieOptions: {
    sameSite: "strict",
    secure: isProd,
    path: "/",
    httpOnly: true,
  },
  size: 64,
  // GET/HEAD/OPTIONS are non-state-changing — no point gating them.
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  // Bind tokens to the requester IP. Operators come from a stable
  // address (office / VPN); an IP change forces a token re-fetch,
  // which the client does transparently on a 403.
  getSessionIdentifier: (req: Request) => req.ip ?? "anonymous",
});

/**
 * GET /admin/auth/csrf — mints a fresh CSRF token, returns it to the
 * client + sets the matching cookie. The client echoes the token in
 * the `x-csrf-token` header on every state-changing call under
 * /admin/auth; `doubleCsrfProtection` rejects a request whose header
 * doesn't HMAC-match the cookie.
 */
export const issueCsrfToken = (req: Request, res: Response): void => {
  const csrfToken = generateCsrfToken(req, res);
  ok(res, { csrfToken });
};

export { doubleCsrfProtection };
