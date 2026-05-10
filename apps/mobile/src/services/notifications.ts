import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

const isExpoGo = Constants.appOwnership === "expo";

// Remote notification APIs were removed from Expo Go in SDK 53+.
// Only register the handler in development builds / standalone apps.
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
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

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (existingStatus !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  const projectId =
    Constants.expoConfig?.extra?.["eas"]?.["projectId"] ??
    Constants.easConfig?.projectId;
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
  Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });

export const cancelReminder = async (id: string): Promise<void> => {
  await Notifications.cancelScheduledNotificationAsync(id);
};
