// TanStack Query hooks over the typed admin API client.
//
// This is the minimum set needed by the app shell + the M3 pages will
// import / extend it. Conventions:
//   - Query keys are produced by the `queryKeys` helper for cache
//     invalidation consistency.
//   - Read hooks expose just the data shape; mutations are added per
//     page (M3) so the call site can wire optimistic updates.

import { useQuery } from "@tanstack/react-query";
import { adminApi } from "./endpoints";

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
