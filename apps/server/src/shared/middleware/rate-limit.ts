// Rate-limit middleware — Phase 4 §T.2.
//
// Ceilings are now flag-service controlled (admin incident playbook:
// tighten limits without redeploy) while keeping the same express-
// rate-limit defaults as before. The `ValueDeterminingMiddleware`
// signature lets the limit function be async — the flag-service
// in-memory cache (30s TTL) means no DB round-trip per request.
//
// Flag keys + defaults (CLAUDE.md "Caching (Redis)" + "Rate Limiting"):
//   rate_limit.default.free   100 req/min   (global default)
//   rate_limit.auth.free       10 req/min   (auth surface)
//   rate_limit.chat.free        3 chat/day  (read by chat.service.ts)
//   rate_limit.readings.free   20 reads/day (read by readings.service.ts)
//
// The last two are NOT enforced here (they are checked inside service
// logic because they are daily counters, not per-minute windows).
// This file exposes helpers to read those flags so both service and the
// admin card share one source of truth.

import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { getFlag } from "../flags/index.js";

// ── flag-backed ceiling helpers ──────────────────────────────────────

/** Reads the current default-surface request cap (req/min, free tier). */
export const getDefaultRateLimitCeiling = (): Promise<number> =>
  getFlag<number>("rate_limit.default.free", 100);

/** Reads the current auth-surface request cap (req/min). */
export const getAuthRateLimitCeiling = (): Promise<number> =>
  getFlag<number>("rate_limit.auth.free", 10);

/** Reads the current chat daily message cap (free tier). */
export const getChatDailyLimit = (): Promise<number> => getFlag<number>("rate_limit.chat.free", 3);

/** Reads the current readings daily cap (free tier). */
export const getReadingsDailyLimit = (): Promise<number> =>
  getFlag<number>("rate_limit.readings.free", 20);

// ── express-rate-limit middleware ────────────────────────────────────

export const defaultRateLimit = rateLimit({
  windowMs: 60_000,
  limit: (_req: Request, _res: Response): Promise<number> => getDefaultRateLimitCeiling(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: (_req: Request, _res: Response): Promise<number> => getAuthRateLimitCeiling(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
