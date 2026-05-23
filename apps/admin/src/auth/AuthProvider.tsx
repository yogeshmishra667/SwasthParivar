import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminUserDto } from "@swasth/shared-types";
import { setAccessToken, setOnUnauthenticated } from "@/api/client";
import { adminApi } from "@/api/endpoints";
import { AuthContext, type AuthState, type AuthStatus } from "./auth-context";

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Owns the admin auth state and wires the in-memory access token to
 * the api client. On mount, calls `/admin/auth/me` — the client
 * transparently uses the refresh cookie if there's no token yet, so a
 * page reload with a valid cookie restores the session without a
 * second round-trip from this provider.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [admin, setAdmin] = useState<AdminUserDto | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const signIn = useCallback((result: { accessToken: string; admin: AdminUserDto }): void => {
    setAccessToken(result.accessToken);
    setAdmin(result.admin);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await adminApi.logout();
    } catch {
      // Server may be unreachable; we still clear local state so the
      // operator isn't trapped on a stale "signed in" UI.
    }
    setAccessToken(null);
    setAdmin(null);
    setStatus("unauthenticated");
  }, []);

  const refreshAdmin = useCallback(async (): Promise<void> => {
    const fresh = await adminApi.me();
    setAdmin(fresh);
  }, []);

  // The api client calls this when the refresh-cookie path fails too.
  useEffect(() => {
    setOnUnauthenticated(() => {
      setAdmin(null);
      setStatus("unauthenticated");
    });
    return (): void => {
      setOnUnauthenticated(null);
    };
  }, []);

  // Boot — attempt to restore the session from the refresh cookie.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await adminApi.me();
        if (!cancelled) {
          setAdmin(me);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setAdmin(null);
          setStatus("unauthenticated");
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, admin, signIn, signOut, refreshAdmin }),
    [status, admin, signIn, signOut, refreshAdmin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
