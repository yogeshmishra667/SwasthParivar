/**
 * Phase 3 — Maintenance-mode middleware (phase3.md CC.12.7 #1).
 *
 * A global 503 kill switch driven by the `maintenance_mode` flag. When
 * the flag is true every request is rejected with 503 MAINTENANCE_MODE
 * — used to take the API down cleanly for a migration or incident
 * without a redeploy. Prerequisite for the Week 12 SOS migration.
 *
 * Exemptions (must stay reachable while maintenance is ON):
 *   - /health, /health/deep — orchestrator liveness/readiness probes.
 *   - /admin/*              — the operator needs the admin flag API to
 *                             turn maintenance mode back OFF.
 *   - /api/v1/sos/*         — an emergency can't wait for maintenance:
 *                             trigger, cancel, resolve, the active-SOS
 *                             screen, and the call-status callbacks that
 *                             drive the escalation (audit D8).
 *   - /api/v1/webhooks/*    — payment webhooks. Each verifies the
 *                             provider's signature before any state
 *                             change; a 503 only delays them into the
 *                             provider's retry window (audit D8).
 *
 * Fail-safe: `getFlag` returns the default `false` if Redis is down, so
 * a flag-store outage never traps the API in maintenance mode.
 *
 * `maintenance_mode` is a plain boolean flag — it is global by design
 * and is NOT resolved through the CC.12 rollout gate.
 */

import type { NextFunction, Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { getFlag } from "../flags/index.js";

// Whole path segments only: /api/v1/sos and /api/v1/sos/..., never /api/v1/sosfoo.
const EXEMPT_ROUTERS = ["/api/v1/sos", "/api/v1/webhooks"] as const;

const isExempt = (path: string): boolean =>
  path.startsWith("/health") ||
  path.startsWith("/admin") ||
  EXEMPT_ROUTERS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export const maintenanceMode = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (isExempt(req.path)) {
    next();
    return;
  }
  const on = await getFlag<boolean>("maintenance_mode", false);
  if (!on) {
    next();
    return;
  }
  // Express 5 propagates this async throw to the shared error handler,
  // which maps MAINTENANCE_MODE → 503 with the standard envelope.
  throw new DomainError(
    "MAINTENANCE_MODE",
    "SwasthParivar abhi maintenance ke liye band hai. Thodi der baad try karein.",
  );
};
