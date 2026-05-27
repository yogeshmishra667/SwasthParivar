// TanStack Query hooks over the typed admin API client.
//
// This is the minimum set needed by the app shell + the M3 pages will
// import / extend it. Conventions:
//   - Query keys are produced by the `queryKeys` helper for cache
//     invalidation consistency.
//   - Read hooks expose just the data shape; mutations are added per
//     page (M3) so the call site can wire optimistic updates.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminRole, AdminTier } from "@swasth/shared-types";
import { adminApi } from "./endpoints";
import type { FlagValue } from "@/flags/types";

// Centralised query keys. Pages import `queryKeys` and use it both for
// `useQuery` and `queryClient.invalidateQueries` so a typo never silently
// breaks cache invalidation.
export const queryKeys = {
  me: () => ["me"] as const,
  users: (params: { search?: string; limit: number; offset: number }) => ["users", params] as const,
  user: (id: string) => ["user", id] as const,
  userResource: (id: string, key: string, params: { limit: number; offset: number }) =>
    ["user", id, "resource", key, params] as const,
  analyticsOverview: () => ["analytics", "overview"] as const,
  analyticsMetric: (key: string) => ["analytics", "metric", key] as const,
  flags: () => ["flags"] as const,
  flag: (key: string) => ["flag", key] as const,
  flagAudit: (key: string) => ["flag", key, "audit"] as const,
  opsHealth: () => ["ops", "health"] as const,
  opsQueues: () => ["ops", "queues"] as const,
  admins: () => ["admins"] as const,
  audit: (params: { action?: string; adminUserId?: string; limit: number; offset: number }) =>
    ["audit", params] as const,
};

// ── Reads ────────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => adminApi.me(),
  });
}

export function useUsers(params: { search?: string; limit?: number; offset?: number } = {}) {
  // exactOptionalPropertyTypes: assemble the object so `search` is
  // omitted (not set to undefined) when no search is in effect.
  const normalized: { search?: string; limit: number; offset: number } = {
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  };
  if (params.search !== undefined) normalized.search = params.search;
  return useQuery({
    queryKey: queryKeys.users(normalized),
    queryFn: () => adminApi.listUsers(normalized),
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: queryKeys.user(id ?? ""),
    queryFn: () => {
      if (!id) throw new Error("useUser: id is required");
      return adminApi.getUser(id);
    },
    enabled: id !== null,
  });
}

/**
 * Lazy panel fetch — sensitive panels write a `patient_data_viewed`
 * audit row on the server, so we only call this when the panel is
 * actually opened. Pass `enabled=false` to keep it dormant.
 */
export function useUserResource(
  id: string,
  key: string,
  params: { limit?: number; offset?: number } = {},
  options: { enabled?: boolean } = {},
) {
  const normalized = { limit: params.limit ?? 50, offset: params.offset ?? 0 };
  return useQuery({
    queryKey: queryKeys.userResource(id, key, normalized),
    queryFn: () => adminApi.getUserResource(id, key, normalized),
    enabled: options.enabled !== false,
  });
}

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: queryKeys.analyticsOverview(),
    queryFn: () => adminApi.analyticsOverview(),
  });
}

export function useFlags() {
  return useQuery({
    queryKey: queryKeys.flags(),
    queryFn: () => adminApi.listFlags(),
  });
}

export function useFlag(key: string | null) {
  return useQuery({
    queryKey: queryKeys.flag(key ?? ""),
    queryFn: () => {
      if (!key) throw new Error("useFlag: key is required");
      return adminApi.getFlag(key);
    },
    enabled: key !== null,
  });
}

export function useOpsHealth() {
  return useQuery({
    queryKey: queryKeys.opsHealth(),
    queryFn: () => adminApi.opsHealth(),
  });
}

export function useOpsQueues() {
  return useQuery({
    queryKey: queryKeys.opsQueues(),
    queryFn: () => adminApi.opsQueues(),
    // BullMQ counts change every job — keep the panel fresh.
    refetchInterval: 10_000,
  });
}

export function useAnalyticsMetric(key: string | null) {
  return useQuery({
    queryKey: queryKeys.analyticsMetric(key ?? ""),
    queryFn: () => {
      if (!key) throw new Error("useAnalyticsMetric: key is required");
      return adminApi.analyticsMetric(key);
    },
    enabled: key !== null,
  });
}

export function useAdmins() {
  return useQuery({
    queryKey: queryKeys.admins(),
    queryFn: () => adminApi.listAdmins(),
  });
}

export function useAuditLog(
  params: {
    action?: string;
    adminUserId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const normalized: { action?: string; adminUserId?: string; limit: number; offset: number } = {
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  };
  if (params.action !== undefined) normalized.action = params.action;
  if (params.adminUserId !== undefined) normalized.adminUserId = params.adminUserId;
  return useQuery({
    queryKey: queryKeys.audit(normalized),
    queryFn: () => adminApi.listAudit(normalized),
  });
}

// ── Mutations ────────────────────────────────────────────────────

/**
 * Patient tier change. On success invalidates the user detail + the
 * users list so the new tier shows up everywhere it's displayed.
 */
export function useChangeUserTier(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tier: AdminTier) => adminApi.changeUserTier(userId, tier),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.user(userId) });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

// Flags — audit + rollout preview reads.

export function useFlagAudit(key: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.flagAudit(key ?? ""),
    queryFn: () => {
      if (!key) throw new Error("useFlagAudit: key is required");
      return adminApi.flagAudit(key);
    },
    enabled: key !== null && options.enabled !== false,
  });
}

/** GET-style evaluate exposed as a mutation so it fires on a button click. */
export function useEvaluateFlag(key: string) {
  return useMutation({
    mutationFn: (userId: string) => adminApi.evaluateFlag(key, userId),
  });
}

// Flag writes — set + rollback + cohort patch.

const invalidateFlag = (queryClient: ReturnType<typeof useQueryClient>, key: string): void => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.flags() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.flag(key) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.flagAudit(key) });
};

export function useSetFlag(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: FlagValue) => adminApi.setFlag(key, value),
    onSuccess: () => {
      invalidateFlag(queryClient, key);
    },
  });
}

export function useRollbackFlag(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.rollbackFlag(key),
    onSuccess: () => {
      invalidateFlag(queryClient, key);
    },
  });
}

// Ops — kill-switch toggle.
export function useSetMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => adminApi.setMaintenance(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flags() });
    },
  });
}

// Admin accounts (super_admin only on the server).

interface CreateAdminInput {
  email: string;
  name: string;
  role: AdminRole;
  password: string;
}

export function useCreateAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAdminInput) => adminApi.createAdmin(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admins() });
    },
  });
}

interface UpdateAdminInput {
  id: string;
  role?: AdminRole;
  active?: boolean;
}

export function useUpdateAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role, active }: UpdateAdminInput) => {
      const body: { role?: AdminRole; active?: boolean } = {};
      if (role !== undefined) body.role = role;
      if (active !== undefined) body.active = active;
      return adminApi.updateAdmin(id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admins() });
    },
  });
}

export function useResetAdminPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      adminApi.resetAdminPassword(id, password),
  });
}
