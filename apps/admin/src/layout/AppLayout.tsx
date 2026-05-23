import { useEffect } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth/auth-context";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Protected layout for every signed-in page. Redirects to /login as
 * soon as auth flips to `unauthenticated`. The server is the source of
 * truth — every request is still RBAC-gated regardless of this guard.
 */
export function AppLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "unauthenticated") {
      void navigate({ to: "/login" });
    }
  }, [status, navigate]);

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Restoring session…
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
