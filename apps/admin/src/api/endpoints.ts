// Typed endpoint functions for every admin route. Pages and query
// hooks call into `adminApi.*`; nothing else should ever build a path
// string by hand. Add a new endpoint by adding one entry here.

import type {
  AdminAuditLogDto,
  AdminLoginResult,
  AdminPatientDetail,
  AdminPatientList,
  AdminResourcePanelData,
  AdminRole,
  AdminTier,
  AdminTierChangeResult,
  AdminTotpEnrollment,
  AdminUserDto,
} from "@swasth/shared-types";
import { request } from "./client";
import type { FlagValue } from "@/flags/types";
import type {
  AdminAuditListResponse,
  AdminListResponse,
  AdminMetricResult,
  AdminResetPasswordResult,
  CohortPatchResult,
  FlagAuditRecord,
  FlagEvaluation,
  FlagRollbackResult,
  FlagWriteResult,
  OpsHealthResponse,
  OpsMaintenanceResult,
  OpsQueuesResponse,
} from "./types";

const enc = encodeURIComponent;

interface ListUsersParams {
  search?: string;
  limit?: number;
  offset?: number;
}

interface ListAuditParams {
  action?: string;
  adminUserId?: string;
  limit?: number;
  offset?: number;
}

interface PanelParams {
  limit?: number;
  offset?: number;
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const adminApi = {
  // ── Auth ──────────────────────────────────────────────────────
  login: (email: string, password: string) =>
    request<AdminLoginResult>("/admin/auth/login", {
      method: "POST",
      json: { email, password },
    }),

  totpEnroll: (challengeToken: string) =>
    request<AdminTotpEnrollment>("/admin/auth/totp/enroll", {
      method: "POST",
      json: { challengeToken },
    }),

  totpConfirm: (challengeToken: string, code: string) =>
    request<AdminLoginResult>("/admin/auth/totp/confirm", {
      method: "POST",
      json: { challengeToken, code },
    }),

  totpVerify: (challengeToken: string, code: string) =>
    request<AdminLoginResult>("/admin/auth/totp/verify", {
      method: "POST",
      json: { challengeToken, code },
    }),

  refresh: () => request<{ accessToken: string }>("/admin/auth/refresh", { method: "POST" }),

  logout: () => request<{ loggedOut: boolean }>("/admin/auth/logout", { method: "POST" }),

  me: () => request<AdminUserDto>("/admin/auth/me"),

  // ── Patient users ─────────────────────────────────────────────
  listUsers: (params: ListUsersParams = {}) =>
    request<AdminPatientList>(
      `/admin/users${qs({
        search: params.search,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })}`,
    ),

  getUser: (id: string) => request<AdminPatientDetail>(`/admin/users/${enc(id)}`),

  getUserResource: (id: string, key: string, params: PanelParams = {}) =>
    request<AdminResourcePanelData>(
      `/admin/users/${enc(id)}/resources/${enc(key)}${qs({
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })}`,
    ),

  changeUserTier: (id: string, tier: AdminTier) =>
    request<AdminTierChangeResult>(`/admin/users/${enc(id)}/tier`, {
      method: "PATCH",
      json: { tier },
    }),

  // ── Analytics ────────────────────────────────────────────────
  analyticsOverview: () => request<{ metrics: AdminMetricResult[] }>("/admin/analytics/overview"),

  analyticsMetric: (key: string) => request<AdminMetricResult>(`/admin/analytics/${enc(key)}`),

  // ── Flags ────────────────────────────────────────────────────
  listFlags: () => request<{ flags: Record<string, FlagValue> }>("/admin/flags"),

  getFlag: (key: string) =>
    request<{ key: string; value: FlagValue | null }>(`/admin/flags/${enc(key)}`),

  flagAudit: (key: string) =>
    request<{ key: string; records: FlagAuditRecord[] }>(`/admin/flags/${enc(key)}/audit`),

  evaluateFlag: (key: string, userId: string) =>
    request<FlagEvaluation>(`/admin/flags/${enc(key)}/evaluate${qs({ userId })}`),

  setFlag: (key: string, value: FlagValue) =>
    request<FlagWriteResult>(`/admin/flags/${enc(key)}`, {
      method: "PUT",
      json: { value },
    }),

  rollbackFlag: (key: string) =>
    request<FlagRollbackResult>(`/admin/flags/${enc(key)}/rollback`, {
      method: "POST",
    }),

  patchCohort: (key: string, body: { add: string[]; remove: string[] }) =>
    request<CohortPatchResult>(`/admin/flags/${enc(key)}/cohort`, {
      method: "PATCH",
      json: body,
    }),

  // ── Ops ──────────────────────────────────────────────────────
  opsQueues: () => request<OpsQueuesResponse>("/admin/ops/queues"),
  opsHealth: () => request<OpsHealthResponse>("/admin/ops/health"),
  setMaintenance: (enabled: boolean) =>
    request<OpsMaintenanceResult>("/admin/ops/maintenance", {
      method: "POST",
      json: { enabled },
    }),

  // ── Admins (RBAC management) ─────────────────────────────────
  listAdmins: () => request<AdminListResponse>("/admin/admins"),

  createAdmin: (body: { email: string; name: string; role: AdminRole; password: string }) =>
    request<AdminUserDto>("/admin/admins", { method: "POST", json: body }),

  updateAdmin: (id: string, body: { role?: AdminRole; active?: boolean }) =>
    request<AdminUserDto>(`/admin/admins/${enc(id)}`, {
      method: "PATCH",
      json: body,
    }),

  resetAdminPassword: (id: string, password: string) =>
    request<AdminResetPasswordResult>(`/admin/admins/${enc(id)}/reset-password`, {
      method: "POST",
      json: { password },
    }),

  // ── Audit ────────────────────────────────────────────────────
  listAudit: (params: ListAuditParams = {}) =>
    request<AdminAuditListResponse>(
      `/admin/audit${qs({
        action: params.action,
        adminUserId: params.adminUserId,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })}`,
    ),
};

export type AdminAuditRecord = AdminAuditLogDto;
