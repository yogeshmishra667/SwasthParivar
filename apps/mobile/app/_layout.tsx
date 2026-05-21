import { initSentry } from "@/services/sentry";
initSentry();

import "@/i18n/config";
import "../global.css";
import "react-native-get-random-values";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useAuthStore } from "@/stores/auth.store";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useProfileInactivity } from "@/hooks/useProfileInactivity";
import { useSyncDrain } from "@/hooks/useSyncDrain";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { FontScaleProvider } from "@/components/shared/FontScaleProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { ProfileSelectorModal } from "@/components/profile/ProfileSelectorModal";
import { isExpoGo } from "@/utils/runtime";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): JSX.Element | null {
  const hydrate = useAuthStore((s) => s.hydrate);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);
  useAccessibility();
  useProfileInactivity();
  useSyncDrain();

  useEffect(() => {
    void (async () => {
      try {
        await hydrate();
      } catch {
        // SecureStore unavailable (e.g. emulator without keystore) — treat as logged out
      } finally {
        setReady(true);
        await SplashScreen.hideAsync();
      }
    })();
  }, [hydrate]);

  useEffect(() => {
    if (!ready || !accessToken) return;
    // Dynamic import: expo-notifications crashes Expo Go on SDK 53+
    // when imported at the top level, so we load it lazily.
    if (isExpoGo) return;
    void import("@/services/notifications").then(
      ({ registerAndSyncPushToken, registerNotificationRouting }) => {
        void registerAndSyncPushToken();
        registerNotificationRouting();
      },
    );
  }, [ready, accessToken]);

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <FontScaleProvider>
            <StatusBar style="dark" />
            <OfflineBanner />
            <ProfileSelectorModal />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat" />
              <Stack.Screen name="guardian" />
              <Stack.Screen name="patient/[id]" options={{ headerShown: true }} />
              <Stack.Screen name="sos" options={{ presentation: "fullScreenModal" }} />
            </Stack>
          </FontScaleProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
