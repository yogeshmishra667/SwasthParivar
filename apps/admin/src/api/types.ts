// Client-side response shapes for endpoints whose DTOs are not yet in
// @swasth/shared-types. Defined here so the typed admin API client
// stays end-to-end type-safe; move into shared-types when / if the
// server adopts these for its own type-checking too.

import type { AdminAuditLogDto, AdminUserDto } from "@swasth/shared-types";
import type { FlagValue } from "@/flags/types";

// ── Analytics ─────────────────────────────────────────────────────

/** One resolved metric — mirrors `apps/server/.../admin-analytics.registry.ts`. */
export interface AdminMetricResult {
  key: string;
  label: string;
  description: string;
  source: "database" | "posthog";
  available: boolean;
  value: unknown;
  note: string | null;
}

// ── Flags ─────────────────────────────────────────────────────────

/** One row of a flag's audit timeline. */
export interface FlagAuditRecord {
  key: string;
  prevValue: FlagValue | null;
  newValue: FlagValue | null;
  by: string;
  at: string;
  action: string;
}

export interface FlagWriteResult {
  key: string;
  prevValue: FlagValue | null;
  newValue: FlagValue;
}

export interface FlagRollbackResult {
  key: string;
  from: FlagValue;
  rolledBackTo: FlagValue;
}

export interface FlagEvaluation {
  key: string;
  userId: string;
  enabled: boolean;
  reason: string;
}

export interface CohortPatchResult {
  key: string;
  userIds: string[];
}

// ── Ops ───────────────────────────────────────────────────────────

export interface OpsQueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface OpsQueuesResponse {
  queues: OpsQueueStat[];
}

export interface OpsHealthResponse {
  status: "ok" | "degraded";
  checks: { db: "ok" | "fail"; redis: "ok" | "fail" };
}

export interface OpsMaintenanceResult {
  enabled: boolean;
}

// ── Admins ────────────────────────────────────────────────────────

export interface AdminListResponse {
  admins: AdminUserDto[];
}

export interface AdminResetPasswordResult {
  id: string;
  reset: true;
}

// ── Audit ─────────────────────────────────────────────────────────

export interface AdminAuditListResponse {
  records: AdminAuditLogDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
