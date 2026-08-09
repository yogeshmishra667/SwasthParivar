// Phase 4 §T.1 / K.4 — premium-gating middleware. Mount AFTER
// `requireAuth` on any endpoint that should be premium-only (unlimited
// chat, advanced insights, full HbA1c history). A free-tier caller gets
// 403 `TIER_UPGRADE_REQUIRED`, which the mobile client renders as the
// upgrade prompt rather than a generic error.
//
// `family` satisfies a `premium` requirement (it is premium × N). The
// check reads `User.tier` live from the DB so a downgrade takes effect
// immediately — there is no token-embedded tier to go stale.

import type { NextFunction, Request, Response } from "express";
import { DomainError } from "@swasth/shared-types";
import { prisma } from "../database.js";

// family outranks premium: a family plan satisfies a premium gate, but
// a premium user must NOT pass a family-specific gate.
const RANK: Record<"free" | "premium" | "family", number> = {
  free: 0,
  premium: 1,
  family: 2,
};

export const requireTier =
  (min: "premium" | "family") =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const userId = req.auth?.sub;
    if (!userId) throw new DomainError("AUTH_UNAUTHORIZED", "missing auth");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });
    if (!user) throw new DomainError("AUTH_UNAUTHORIZED", "unknown user");

    const required = min === "family" ? RANK.family : RANK.premium;
    if (RANK[user.tier] < required) {
      throw new DomainError(
        "TIER_UPGRADE_REQUIRED",
        "This feature requires a premium subscription.",
      );
    }
    next();
  };
