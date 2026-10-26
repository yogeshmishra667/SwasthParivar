import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { ANDROID_NOTIFICATION_CHANNELS } from "@swasth/shared-types";
import { router } from "expo-router";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { markNotificationSeen } from "@/services/notification-dedup";
import { useProfileStore } from "@/stores/profile.store";
import { useAuthStore } from "@/stores/auth.store";
import {
  criticalReasonKey,
  useCriticalAlertStore,
  type CriticalAlertCategory,
} from "@/stores/critical-alert.store";
import { isExpoGo } from "@/utils/runtime";

// Remote notification APIs were removed from Expo Go in SDK 53+.
// Only register the handler in development builds / standalone apps.
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const id = (notification.request.content.data as { notificationId?: string } | null)
        ?.notificationId;
      const isNew = await markNotificationSeen(id);
      if (!isNew) {
        return {
          shouldShowAlert: false,
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
  });
}

const ANDROID_IMPORTANCE = {
  default: Notifications.AndroidImportance.DEFAULT,
  high: Notifications.AndroidImportance.HIGH,
  max: Notifications.AndroidImportance.MAX,
} as const;

/**
 * Creates every Android channel the server may push to. Android silently
 * drops a push whose channel doesn't exist on the device (audit P10) —
 * reminders, medicines and guardian alerts all went missing that way.
 * Idempotent; runs before the token is registered.
 */
export const ensureAndroidChannels = async (): Promise<void> => {
  if (Platform.OS !== "android") return;
  for (const [id, channel] of Object.entries(ANDROID_NOTIFICATION_CHANNELS)) {
    const critical = id === "critical";
    await Notifications.setNotificationChannelAsync(id, {
      name: channel.name,
      importance: ANDROID_IMPORTANCE[channel.importance],
      vibrationPattern: critical ? [0, 500, 250, 500] : [0, 250, 250, 250],
      lightColor: critical ? "#DC2626" : "#2563EB",
      ...("bypassDnd" in channel ? { bypassDnd: channel.bypassDnd } : {}),
    });
  }
};

export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  if (!Device.isDevice) return null;
  if (isExpoGo) return null;

  await ensureAndroidChannels();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return null;

  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const easConfig = Constants.easConfig as { projectId?: string } | null | undefined;
  const projectId: string | undefined = extra?.eas?.projectId ?? easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
};

/**
 * Result of the registration attempt. Surfaced so a debug surface (and
 * Sentry breadcrumbs) can distinguish:
 *   - `not_a_device` — running on a simulator/emulator without FCM/APNS
 *   - `expo_go` — bundled inside Expo Go (no remote-push support since SDK 53)
 *   - `permission_denied` — the user dismissed the OS prompt
 *   - `no_token` — Expo returned null (project id mismatch, FCM unreachable)
 *   - `server_post_failed` — POST /auth/push-token failed (auth, network)
 *   - `synced` — happy path
 *
 * The original silent-catch behaviour is preserved; this just makes the
 * failure mode visible to the caller and to Sentry breadcrumbs.
 */
export type PushTokenSyncResult =
  | { ok: false; reason: "not_a_device" | "expo_go" | "permission_denied" | "no_token" }
  | { ok: false; reason: "server_post_failed"; error: unknown }
  | { ok: true; reason: "synced"; token: string };

const probeRegistration = async (): Promise<PushTokenSyncResult> => {
  if (!Device.isDevice) return { ok: false, reason: "not_a_device" };
  if (isExpoGo) return { ok: false, reason: "expo_go" };

  await ensureAndroidChannels();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return { ok: false, reason: "permission_denied" };

  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const easConfig = Constants.easConfig as { projectId?: string } | null | undefined;
  const projectId: string | undefined = extra?.eas?.projectId ?? easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  if (!token.data) return { ok: false, reason: "no_token" };
  return { ok: true, reason: "synced", token: token.data };
};

export const registerAndSyncPushToken = async (): Promise<PushTokenSyncResult> => {
  const probe = await probeRegistration().catch((err): PushTokenSyncResult => {
    logError("registerAndSyncPushToken.probe", err);
    return { ok: false, reason: "no_token" };
  });
  if (!probe.ok) return probe;

  try {
    await api.post("/auth/push-token", {
      token: probe.token,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
      deviceId: Device.osInternalBuildId ?? undefined,
    });
    return probe;
  } catch (err) {
    logError("registerAndSyncPushToken.post", err);
    return { ok: false, reason: "server_post_failed", error: err };
  }
};

export const scheduleMedicationReminder = async (
  id: string,
  title: string,
  body: string,
  date: Date,
): Promise<string> =>
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });

export const cancelReminder = async (id: string): Promise<void> => {
  await Notifications.cancelScheduledNotificationAsync(id);
};

// A household notification carries `targetUserId` — the profile it was
// addressed to. On a shared phone, switch the active profile to it
// BEFORE routing, so a tapped "Maa ji" reminder lands the app on Maa's
// profile rather than whoever was last active. No-ops when the profile
// is unknown to this device, already active, or the switcher is locked
// mid-logging (profile.store enforces the lock).
const switchProfileFromNotificationData = (data: unknown): void => {
  const targetUserId = (data as { targetUserId?: string } | null)?.targetUserId;
  if (typeof targetUserId !== "string") return;

  const store = useProfileStore.getState();
  if (store.activeProfileId === targetUserId) return;
  if (!store.profiles.some((p) => p.id === targetUserId)) return;
  store.switchProfile(targetUserId);
};

interface CriticalAlertPushData {
  type?: string;
  notificationId?: string;
  targetUserId?: string;
  readingId?: string;
  category?: string;
  severity?: string;
  copyKey?: string;
  valueLabel?: string;
}

const CRITICAL_CATEGORIES: readonly CriticalAlertCategory[] = [
  "glucose",
  "bp",
  "cardiac",
  "respiratory",
];

/**
 * Is this push about a profile on this device? The logged-in account
 * always is. Before the household is loaded (e.g. a cold-start tap) we
 * can't tell, so fail toward the patient's own alert, with its lock,
 * contact and auto-dial (P3 review C1).
 */
const isOwnProfile = (targetUserId: string): boolean => {
  if (targetUserId === useAuthStore.getState().userId) return true;
  const { householdId, profiles } = useProfileStore.getState();
  if (householdId === null) return true;
  return profiles.some((p) => p.id === targetUserId);
};

/**
 * A `critical_alert` push raises the fullscreen alert (audit P3). On a
 * device that holds the reading's profile it is the patient's own alert
 * (skipped when it only echoes one this device already showed); anywhere
 * else it is a family member's, with the push's own title and body.
 */
export const raiseCriticalAlertFromPush = (
  data: unknown,
  content: { title?: string | null; body?: string | null } = {},
): void => {
  const p = data as CriticalAlertPushData | null;
  if (p?.type !== "critical_alert" || typeof p.targetUserId !== "string") return;
  // A push without a category is a glucose alert (the original shape).
  const known: CriticalAlertCategory | undefined =
    p.category === undefined ? "glucose" : CRITICAL_CATEGORIES.find((c) => c === p.category);
  const category: CriticalAlertCategory = known ?? "glucose";
  // An unknown category shows the push's own copy, never glucose's (review W5).
  const pushCopy =
    content.title && content.body ? { title: content.title, body: content.body } : {};
  const direction: "low" | "high" | undefined =
    category === "glucose"
      ? p.severity === "low"
        ? "low"
        : "high"
      : category === "bp"
        ? p.copyKey === "critical.bp.low"
          ? "low"
          : "high"
        : undefined;
  const common = {
    category,
    ...(direction !== undefined ? { direction } : {}),
    ...(category === "cardiac" || category === "respiratory"
      ? { reasonKey: criticalReasonKey(p.copyKey) }
      : {}),
    ...(typeof p.valueLabel === "string" ? { valueLabel: p.valueLabel } : {}),
  };
  // The received and the tapped handler both see the same push: show it once.
  const dedupeId =
    typeof p.readingId === "string"
      ? p.readingId
      : typeof p.notificationId === "string"
        ? p.notificationId
        : null;
  const alerts = useCriticalAlertStore.getState();
  if (isOwnProfile(p.targetUserId)) {
    alerts.raiseFromPush(
      {
        audience: "patient",
        userId: p.targetUserId,
        ...common,
        ...(known === undefined ? pushCopy : {}),
      },
      dedupeId,
    );
    return;
  }
  alerts.raiseFromPush(
    { audience: "guardian", userId: null, patientId: p.targetUserId, ...common, ...pushCopy },
    dedupeId,
  );
};

// Phase 3 Feature C — deep-link a tapped notification to its screen.
// Silent Guardian alerts open AlertDetail; the daily summary opens
// GuardianHome. Other notification types fall through (handled, if at
// all, by their own screens).
const routeFromNotificationData = (
  data: unknown,
  content: { title?: string | null; body?: string | null } = {},
): void => {
  const payload = data as { type?: string; alertId?: string } | null;
  if (!payload) return;
  switchProfileFromNotificationData(data);
  raiseCriticalAlertFromPush(data, content);
  if (payload.type === "guardian_alert" && typeof payload.alertId === "string") {
    router.push({
      pathname: "/guardian/alert/[alertId]",
      params: { alertId: payload.alertId },
    });
  } else if (payload.type === "guardian_daily_summary") {
    router.push("/guardian");
  }
};

// Registered once at app start (from the root layout). Handles both a
// cold start — app launched by tapping a notification — and taps while
// the app is already running.
export const registerNotificationRouting = (): void => {
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      routeFromNotificationData(
        response.notification.request.content.data,
        response.notification.request.content,
      );
    }
  });
  Notifications.addNotificationResponseReceivedListener((response) => {
    routeFromNotificationData(
      response.notification.request.content.data,
      response.notification.request.content,
    );
  });
  // A critical alert arriving while the app is open goes fullscreen at
  // once, without waiting for a tap (audit P3).
  Notifications.addNotificationReceivedListener((notification) => {
    raiseCriticalAlertFromPush(notification.request.content.data, notification.request.content);
  });
};
