import { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { captureError } from "@/services/sentry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorId: number;
}

/**
 * Top-level error boundary — last line of defence for an elderly user who
 * would otherwise see a white screen when a render crash happens. Catches
 * sync render errors, sends them to Sentry (no-op without DSN), and shows
 * a friendly Hindi recovery screen with one big "App phir se kholein" tap.
 *
 * What it does NOT catch:
 *   - Async errors in event handlers / effects (use try/catch + captureError)
 *   - Errors outside React (queue jobs, Sentry internals)
 *   - Errors during SSR (we have no SSR here)
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, errorId: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error, {
      componentStack: info.componentStack,
      boundary: "RootErrorBoundary",
    });
  }

  private readonly handleRestart = (): void => {
    // We can't truly hard-restart from RN userspace without a native bridge
    // call, so we reset the boundary state. If the underlying crash is
    // deterministic the user will hit it again — that's still better than a
    // white screen, because Sentry will get a second event with more
    // context and the user has a clear "press again" affordance.
    this.setState({ hasError: false, errorId: this.state.errorId + 1 });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-6">
        <Text className="text-2xl font-bold text-neutral-900 mb-3 text-center">
          Kuch gadbad hui 😔
        </Text>
        <Text className="text-base text-neutral-700 mb-8 text-center leading-6">
          App mein technical dikkat aayi hai. Aapka data safe hai — kuch nahi khoya.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="App phir se kholein"
          onPress={this.handleRestart}
          className="bg-primary-600 px-8 py-4 rounded-2xl active:opacity-80"
          style={{ minHeight: 48, minWidth: 48 }}
        >
          <Text className="text-white text-lg font-semibold">App phir se kholein</Text>
        </Pressable>
        <Text className="text-xs text-neutral-500 mt-6 text-center">
          Agar dikkat ho rahi hai, phone restart karein.
        </Text>
      </View>
    );
  }
}
