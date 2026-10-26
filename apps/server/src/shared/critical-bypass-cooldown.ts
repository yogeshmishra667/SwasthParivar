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
// The cooldown itself is CRITICAL_COOLDOWN_MINUTES (30) from
// `@swasth/domain-logic` — the pure planner compares timestamps, so the
// key's TTL doesn't decide it. The TTL is twice the window so a replay,
// planned as of when its reading was saved up to 30 min earlier, still
// sees the stamp that suppressed it (audit P5).

import { CRITICAL_COOLDOWN_MINUTES } from "@swasth/domain-logic";
import { redis } from "./redis.js";
import { withTimeout } from "./with-timeout.js";

const COOLDOWN_TTL_SEC = CRITICAL_COOLDOWN_MINUTES * 60 * 2;

// The shared Redis client runs with `maxRetriesPerRequest: null`, so during
// an outage a command HANGS instead of failing — and the fail-open catch
// below would never run, stalling the critical-bypass dispatch behind it
// (audit P5). Bound every call so "Redis down → bypass" actually happens.
const REDIS_TIMEOUT_MS = 500;

const bounded = <T>(p: Promise<T>): Promise<T> => withTimeout(p, REDIS_TIMEOUT_MS, "redis");

type Category = "bp" | "cardiac" | "respiratory";

const key = (category: Category, userId: string): string =>
  `critical_bypass:cooldown:${category}:${userId}`;

/**
 * Returns the ISO timestamp of the most recent bypass dispatch in the
 * given category for this user, or `null` if outside the cooldown
 * window (or never dispatched). The pure planner consumes this value
 * as `lastBypassTriggeredAtIso` and decides whether the suppression
 * branch fires — see `planMultiCategoryBypassDispatch`.
 *
 * Fail-safe: Redis down or slow → returns `null` → planner treats it as "no
 * recent bypass" → dispatch proceeds. A Redis outage can never silence
 * a real critical alert. The cost is a duplicate alert if the Redis
 * blip happens within 30 min of a prior bypass — acceptable trade.
 */
export interface LastBypass {
  readonly atIso: string;
  /**
   * The reading version whose dispatch set the stamp (`<readingId>-v<n>`),
   * so a replay can tell its OWN earlier dispatch from another reading's
   * cooldown. Null for stamps written before this was recorded.
   */
  readonly owner: string | null;
}

export const bypassOwner = (readingId: string, version: number): string =>
  `${readingId}-v${version}`;

export const getLastBypass = async (
  category: Category,
  userId: string,
): Promise<LastBypass | null> => {
  try {
    const raw = await bounded(redis.get(key(category, userId)));
    if (raw === null) return null;
    const [atIso = raw, owner] = raw.split("|");
    return { atIso, owner: owner ?? null };
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
  owner: string,
): Promise<void> => {
  try {
    await bounded(redis.set(key(category, userId), `${nowIso}|${owner}`, "EX", COOLDOWN_TTL_SEC));
  } catch {
    // intentional swallow — safety-first, see header comment
  }
};
