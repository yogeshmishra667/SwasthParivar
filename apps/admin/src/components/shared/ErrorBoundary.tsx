import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Override the default fallback UI. */
  fallback?: (state: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level safety net so a render error in one page doesn't blank the
 * whole console. Renders a recoverable fallback with the message and a
 * Reload button. The TanStack Router has its own per-route error
 * component (`defaultErrorComponent`) — this catches what slips past
 * that, mainly errors that throw before the router even mounts (e.g.
 * a provider misconfiguration).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The admin app is staff-facing; verbose logging is fine here. In
    // production this should also forward to Sentry — wire that in when
    // the admin SPA gets its own Sentry DSN (see docs/SETUP.md).
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }

    return (
      <div className="flex h-full items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertOctagon className="h-4 w-4" />
          <AlertTitle>The console hit an unexpected error</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="font-mono text-xs">{error.message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                this.reset();
              }}
            >
              Reload the page
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}
