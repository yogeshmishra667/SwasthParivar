import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { markNotificationSeen } from "@/services/notification-dedup";
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

export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  if (!Device.isDevice) return null;
  if (isExpoGo) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563EB",
    });
    await Notifications.setNotificationChannelAsync("critical", {
      name: "Critical health alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: "#DC2626",
      bypassDnd: true,
    });
  }

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
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return token.data;
};

export const registerAndSyncPushToken = async (): Promise<void> => {
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await api.post("/auth/push-token", {
      token,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
      deviceId: Device.osInternalBuildId ?? undefined,
    });
  } catch (err) {
    logError("registerAndSyncPushToken", err);
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
