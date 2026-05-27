import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import type { AdminRole } from "@swasth/shared-types";
import { useAdminRole } from "@/auth/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface AccessDeniedProps {
  /** Roles allowed to use this page. Renders the body when the current admin matches. */
  allow: readonly AdminRole[];
  children: ReactNode;
}

/**
 * Page-level RBAC gate. The server is still the source of truth — every
 * call here is independently RBAC-checked — but this saves a 403 round-
 * trip and gives the operator a clear message instead of a Failed-to-
 * load toast when they navigate directly to a URL they can't see.
 */
export function AccessDenied({ allow, children }: AccessDeniedProps) {
  const role = useAdminRole();
  if (role && allow.includes(role)) return <>{children}</>;
  return (
    <Alert>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>You don't have access to this page</AlertTitle>
      <AlertDescription>
        This area is restricted to <code>{allow.join(", ")}</code> — ask a super_admin if you need
        it.
      </AlertDescription>
    </Alert>
  );
}
