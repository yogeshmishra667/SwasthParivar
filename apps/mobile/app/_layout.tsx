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
import { usePreferencesStore } from "@/stores/preferences.store";
import { useProfileStore, selectActiveProfile } from "@/stores/profile.store";
import { syncCheckReminders } from "@/services/check-reminders";
import { useColorScheme } from "nativewind";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useProfileInactivity } from "@/hooks/useProfileInactivity";
import { useSyncDrain } from "@/hooks/useSyncDrain";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { MaintenanceBanner } from "@/components/shared/MaintenanceBanner";
import { FontScaleProvider } from "@/components/shared/FontScaleProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { ProfileSelectorModal } from "@/components/profile/ProfileSelectorModal";
import { CriticalAlertHost } from "@/components/logging/CriticalAlertHost";
import { isExpoGo } from "@/utils/runtime";
import { useFeatureFlags } from "@/stores/feature-flags.store";
import { setOnMaintenanceMode } from "@/services/api";

void SplashScreen.preventAutoHideAsync();

import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";

export default function RootLayout(): JSX.Element | null {
  const hydrate = useAuthStore((s) => s.hydrate);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const theme = usePreferencesStore((s) => s.theme);
  const scheme = useColorScheme();
  const colorScheme = scheme.colorScheme;

  useEffect(() => {
    const next = theme === "high-contrast" ? "light" : theme;
    scheme.setColorScheme(next);
  }, [theme, scheme]);

  useAccessibility();
  useProfileInactivity();
  useSyncDrain();

  // Resync local check-frequency reminders whenever the active profile
  // (and therefore its conditions) changes. Without this, switching
  // from a diabetes profile to a hypertension profile would leave the
  // notification copy stuck on "Sugar check ka time" until the next
  // preference change. The schedule itself is identical — we just
  // re-render the title/body via composeReminderCopy.
  const activeProfile = useProfileStore(selectActiveProfile);
  // Listen on id+conditions; depending on the whole `activeProfile`
  // object would resync on every unrelated profile-store mutation
  // (lastActiveAt, lock flags, …).
  const profileId = activeProfile?.id;
  const conditions = activeProfile?.conditions;
  useEffect(() => {
    if (!profileId) return;
    const prefs = usePreferencesStore.getState();
    void syncCheckReminders({
      enabled: prefs.notificationsEnabled,
      frequency: prefs.checkFrequency,
      reminderTime: prefs.reminderTime,
      conditions,
    });
  }, [profileId, conditions]);

  useEffect(() => {
    setOnMaintenanceMode(setMaintenanceActive);
    return () => setOnMaintenanceMode(null);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await hydrate();
      } catch {
        // SecureStore unavailable
      } finally {
        setReady(true);
        await SplashScreen.hideAsync();
      }
    })();
  }, [hydrate]);

  useEffect(() => {
    if (!ready || !accessToken) return;
    const setPushTokenStatus = usePreferencesStore.getState().setPushTokenStatus;

    // Reconcile preferences with the server (server wins). Runs once
    // per auth-token change, in parallel with push-token registration
    // since neither depends on the other.
    void usePreferencesStore.getState().hydrateFromServer();

    // Hydrate per-user feature flags (CC.12) so the log tab gates
    // cardiac / respiratory surfaces correctly. Also runs in parallel.
    void useFeatureFlags.getState().refresh();

    if (isExpoGo) {
      setPushTokenStatus("expo_go");
      return;
    }

    void import("@/services/notifications").then(
      async ({ registerAndSyncPushToken, registerNotificationRouting }) => {
        const res = await registerAndSyncPushToken();
        setPushTokenStatus(res.ok ? "synced" : res.reason);
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
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
              <OfflineBanner />
              <MaintenanceBanner active={maintenanceActive} />
              <ProfileSelectorModal />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat" />
                <Stack.Screen name="guardian" />
                <Stack.Screen name="patient/[id]" options={{ headerShown: true }} />
                <Stack.Screen name="settings/emergency-contacts" options={{ headerShown: true }} />
                <Stack.Screen name="sos" options={{ presentation: "fullScreenModal" }} />
              </Stack>
              {/* The app's one fullscreen critical alert, above every screen (audit P3). */}
              <CriticalAlertHost />
            </ThemeProvider>
          </FontScaleProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
