// Per-category critical-bypass cooldown.
//
// CLAUDE.md "Phase 4 Invariants — Multi-condition Critical-Bypass
// Dispatch": "Cooldown is per-category, not global — glucose-low
// followed by BP-high 5min later both fire." Glucose continues to use
// its own historic cooldown source (`FeedbackEvent.feedbackType =
// 'critical_warn'`) for backward compatibility. Cardiac + respiratory
// use this Redis-backed module so they don't pollute the feedback log
// and so a fresh boot has no cross-category bleed-through.
//
// The TTL matches CRITICAL_COOLDOWN_MINUTES (30) from
// `@swasth/domain-logic`, the same constant the pure planner reads.

import { CRITICAL_COOLDOWN_MINUTES } from "@swasth/domain-logic";
import { redis } from "./redis.js";

const COOLDOWN_TTL_SEC = CRITICAL_COOLDOWN_MINUTES * 60;

type Category = "cardiac" | "respiratory";

const key = (category: Category, userId: string): string =>
  `critical_bypass:cooldown:${category}:${userId}`;

/**
 * Returns the ISO timestamp of the most recent bypass dispatch in the
 * given category for this user, or `null` if outside the cooldown
 * window (or never dispatched). The pure planner consumes this value
 * as `lastBypassTriggeredAtIso` and decides whether the suppression
 * branch fires — see `planMultiCategoryBypassDispatch`.
 *
 * Fail-safe: Redis down → returns `null` → planner treats it as "no
 * recent bypass" → dispatch proceeds. A Redis outage can never silence
 * a real critical alert. The cost is a duplicate alert if the Redis
 * blip happens within 30 min of a prior bypass — acceptable trade.
 */
export const getLastBypassIso = async (
  category: Category,
  userId: string,
): Promise<string | null> => {
  try {
    return await redis.get(key(category, userId));
  } catch {
    return null;
  }
};

/**
 * Stamp a fresh dispatch into Redis. Called after the service decides
 * the bypass chain will actually enqueue (i.e. `withinCooldown === false`).
 * Idempotent on retry — same key, same TTL.
 *
 * Fail-safe: Redis down → throws silently swallowed → next bypass will
 * also dispatch. Same trade-off as the read path.
 */
export const markBypassed = async (
  category: Category,
  userId: string,
  nowIso: string,
): Promise<void> => {
  try {
    await redis.set(key(category, userId), nowIso, "EX", COOLDOWN_TTL_SEC);
  } catch {
    // intentional swallow — safety-first, see header comment
  }
};
