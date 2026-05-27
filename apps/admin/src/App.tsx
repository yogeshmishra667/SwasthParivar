import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/auth/AuthProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queryClient";
import { router } from "@/router/router";
import { ThemeProvider } from "@/theme/ThemeProvider";

/**
 * Top-level providers. Order matters: ErrorBoundary is the outermost
 * safety net so a render crash anywhere — including in a provider —
 * renders a recoverable fallback rather than a blank screen.
 * ThemeProvider applies the `.dark` class to <html> on mount, so it
 * wraps anything that renders before paint. AuthProvider sits inside
 * so it can toast errors via the Sonner Toaster (a sibling).
 * RouterProvider lives innermost so every route — including /login —
 * has access to auth + queries.
 */
export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
