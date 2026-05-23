import type { AdminRole } from "@swasth/shared-types";
import type { ReactNode } from "react";
import { useAdminRole } from "@/auth/auth-context";

interface RoleGateProps {
  /** Roles allowed to see `children`. Other roles see `fallback` (or nothing). */
  allow: readonly AdminRole[];
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Render `children` only when the signed-in admin's role is in `allow`.
 * Source of truth for visibility is still the server (the API enforces
 * RBAC); this component is a UX nicety that hides controls the user
 * cannot use anyway. Never rely on it for security.
 */
export function RoleGate({ allow, fallback = null, children }: RoleGateProps) {
  const role = useAdminRole();
  if (role && allow.includes(role)) return <>{children}</>;
  return <>{fallback}</>;
}
