// Redis-backed feature flag service.
//
// Why this exists: ops needs kill switches for misbehaving features
// without a redeploy. Examples: WhatsApp OTP outage → force SMS;
// MSG91 rate-limit → push-only; voice recognition bug → numpad-only.
//
// What stays HARDCODED (never flagged — medical safety per CLAUDE.md):
//   - Critical-bypass thresholds (<65, >315)
//   - Bypass-chain step ordering + parallel execution
//   - 30-min critical cooldown
//   - 3 AM streak day boundary
// Touching any of those needs a code change + audit-trail commit.
//
// Storage layout:
//   flag:<key>        → JSON value (string | number | boolean | object)
//   flag-audit:<key>  → list of {ts, prevValue, newValue, by} (LPUSH, capped)
//
// Cache: 30s in-process map. Set bypasses the cache via Redis pubsub
// (cheap consistency without distributed locks).

import type { Redis } from "ioredis";
import * as Sentry from "@sentry/node";
import { redis } from "../redis.js";
import { logger } from "../logger.js";
import { capture } from "../analytics/posthog.js";

const CACHE_TTL_MS = 30_000;
const AUDIT_RETENTION = 100;
const FLAG_PREFIX = "flag:";
const AUDIT_PREFIX = "flag-audit:";
const PUBSUB_CHANNEL = "flag-invalidations";

export type FlagValue = string | number | boolean | Record<string, unknown> | unknown[];

interface CacheEntry {
  value: FlagValue | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

// Lazy subscriber — only created when get/set is actually called the
// first time. Keeps test runs (and the no-redis purity layer) from
// touching ioredis.
let subscriber: Redis | null = null;

const ensureSubscriber = (): void => {
  if (subscriber) return;
  subscriber = redis.duplicate();
  void subscriber.subscribe(PUBSUB_CHANNEL).catch((err: unknown) => {
    logger.warn({ err }, "flag pubsub subscribe failed — falling back to TTL only");
  });
  subscriber.on("message", (_channel, message) => {
    // message is the flag key; clear that one entry only.
    cache.delete(message);
  });
};

const isExpired = (entry: CacheEntry): boolean => Date.now() - entry.fetchedAt > CACHE_TTL_MS;

// CC.12.6 — classify a flag value so flag-change telemetry can pivot on
// rollout kind. Mirrors the shapes the CC.12 `evaluateRollout` resolver
// accepts; a non-rollout config value (e.g. the `auth.otp.provider`
// string) classifies as `other`.
type RolloutKind = "boolean" | "cohort" | "percentage" | "cohort_or_percentage" | "other";

const classifyRolloutKind = (value: FlagValue): RolloutKind => {
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const rollout = value.rollout;
    if (rollout === "cohort" || rollout === "percentage" || rollout === "cohort_or_percentage") {
      return rollout;
    }
  }
  return "other";
};

// CC.12.6 — a rollout/rollback is an operational event; surface it on
// PostHog + Sentry next to the feature's own metrics. Telemetry failure
// must never break the flag write itself.
const emitFlagChangeTelemetry = (key: string, value: FlagValue, by: string): void => {
  const rolloutKind = classifyRolloutKind(value);
  try {
    capture("feature_flag_changed", by, { key, rollout_kind: rolloutKind, by });
    Sentry.addBreadcrumb({
      category: "feature_flag",
      message: `flag ${key} changed`,
      level: "info",
      data: { key, rollout_kind: rolloutKind, by },
    });
  } catch (err) {
    logger.warn({ err, key }, "flag-change telemetry emit failed");
  }
};

const parse = (raw: string | null): FlagValue | null => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as FlagValue;
  } catch {
    return raw;
  }
};

// Defensive cap on a single Redis lookup. The shared ioredis client
// is configured with `maxRetriesPerRequest: null` (buffer indefinitely
// across reconnects), so a stuck connection would otherwise block the
// caller forever — and since Phase 4 §T.2 the rate-limit middleware
// calls getFlag on every request, that means every request queues
// behind a dead Redis. Falling back to the default after 250ms keeps
// the request path live; the next request retries.
const FLAG_READ_TIMEOUT_MS = 250;

const withTimeout = <T>(p: Promise<T>, ms: number, tag: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${tag} timeout after ${ms}ms`)), ms),
    ),
  ]);

/**
 * Read a flag. Returns the default value (and does not cache it) when
 * the key is unset, so a later set of the same key is immediately
 * visible without flushing.
 */
export const getFlag = async <T extends FlagValue>(key: string, defaultValue: T): Promise<T> => {
  ensureSubscriber();
  const cached = cache.get(key);
  if (cached && !isExpired(cached)) {
    return (cached.value ?? defaultValue) as T;
  }

  try {
    const raw = await withTimeout(
      redis.get(FLAG_PREFIX + key),
      FLAG_READ_TIMEOUT_MS,
      `flag read ${key}`,
    );
    const value = parse(raw);
    cache.set(key, { value, fetchedAt: Date.now() });
    return (value ?? defaultValue) as T;
  } catch (err) {
    // Redis down / slow → fail safe to default. Critical paths should
    // also hardcode their "safe" default rather than relying on Redis.
    logger.warn({ err, key }, "flag read failed — using default");
    return defaultValue;
  }
};

/**
 * Write a flag and append an audit record. Returns the previous value
 * (null if unset) so the caller can include it in their own log line.
 */
export const setFlag = async (
  key: string,
  value: FlagValue,
  by: string,
): Promise<FlagValue | null> => {
  ensureSubscriber();
  const fullKey = FLAG_PREFIX + key;
  const auditKey = AUDIT_PREFIX + key;
  const serialised = JSON.stringify(value);

  const prevRaw = await redis.get(fullKey);
  const prev = parse(prevRaw);

  await redis
    .multi()
    .set(fullKey, serialised)
    .lpush(
      auditKey,
      JSON.stringify({
        ts: new Date().toISOString(),
        prevValue: prev,
        newValue: value,
        by,
      }),
    )
    .ltrim(auditKey, 0, AUDIT_RETENTION - 1)
    .publish(PUBSUB_CHANNEL, key)
    .exec();

  cache.delete(key);
  logger.info({ key, by, prev, next: value }, "flag updated");
  emitFlagChangeTelemetry(key, value, by);
  return prev;
};

/**
 * Read a flag without a default. Returns null when unset — intended for
 * the admin surface (which needs to distinguish "unset" from `false`).
 * Application code should keep using getFlag(key, default).
 */
export const getFlagOrNull = async (key: string): Promise<FlagValue | null> => {
  ensureSubscriber();
  const cached = cache.get(key);
  if (cached && !isExpired(cached)) return cached.value;
  try {
    const raw = await redis.get(FLAG_PREFIX + key);
    const value = parse(raw);
    cache.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch (err) {
    logger.warn({ err, key }, "flag read failed");
    return null;
  }
};

export const listFlags = async (): Promise<Record<string, FlagValue>> => {
  const keys = await redis.keys(FLAG_PREFIX + "*");
  if (keys.length === 0) return {};
  const values = await redis.mget(...keys);
  const out: Record<string, FlagValue> = {};
  keys.forEach((k, i) => {
    const parsed = parse(values[i] ?? null);
    if (parsed !== null) out[k.slice(FLAG_PREFIX.length)] = parsed;
  });
  return out;
};

interface AuditRecord {
  ts: string;
  prevValue: FlagValue | null;
  newValue: FlagValue;
  by: string;
}

export const getAudit = async (key: string, limit = 20): Promise<AuditRecord[]> => {
  const records = await redis.lrange(AUDIT_PREFIX + key, 0, limit - 1);
  return records
    .map((r) => {
      try {
        return JSON.parse(r) as AuditRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is AuditRecord => r !== null);
};

// Test seam — drop in-process cache. Tests can reset state between specs.
export const __resetFlagCache = (): void => {
  cache.clear();
};
