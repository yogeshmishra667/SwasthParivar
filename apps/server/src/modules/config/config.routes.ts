/**
 * Phase 3 — Feature config endpoint (phase3.md CC.12.4).
 * Rollback runbook: docs/runbooks/rollback.md#chat
 *
 * Routes mounted under /api/v1/config. Auth required.
 *
 *   GET /features   feature rollout map resolved for the calling user
 *
 * This endpoint reports flag state; it never changes it. Flag writes
 * stay on the admin surface (`PUT /admin/flags/:key`).
 */

import { Router } from "express";
import { requireAuth } from "../../shared/middleware/auth.js";
import * as controller from "./config.controller.js";

export const configRouter: Router = Router();

configRouter.use(requireAuth);

configRouter.get("/features", controller.getFeatures);
