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
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { registerAndSyncPushToken } from "@/services/notifications";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): JSX.Element | null {
  const hydrate = useAuthStore((s) => s.hydrate);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);
  useAccessibility();

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
    void registerAndSyncPushToken();
  }, [ready, accessToken]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sos" options={{ presentation: "fullScreenModal" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
