// Auth context shape + read-side hooks. The provider lives in
// `auth/AuthProvider.tsx` (M2-T3) and wires real API calls; this
// module is import-safe from any component, including those built
// before the provider (e.g. RoleGate).

import { createContext, useContext } from "react";
import type { AdminRole, AdminUserDto } from "@swasth/shared-types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * The shape consumed by `useAuth`. The access token itself is held in
 * the api client module (in memory only) — never on context — so it
 * cannot leak through a React DevTools tree.
 */
export interface AuthState {
  status: AuthStatus;
  admin: AdminUserDto | null;
  /** Persist a freshly-minted session (called by the login flow). */
  signIn: (result: { accessToken: string; admin: AdminUserDto }) => void;
  /** Clear local state and revoke the server-side refresh cookie. */
  signOut: () => Promise<void>;
  /** Re-fetch `/admin/auth/me` (e.g. after a role change). */
  refreshAdmin: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used inside <AuthProvider>.");
  }
  return ctx;
}

/** Convenience: the current admin's role, or null when unauthenticated. */
export function useAdminRole(): AdminRole | null {
  return useAuth().admin?.role ?? null;
}
