import { View, Text, Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "@/stores/preferences.store";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { Icon } from "@/components/ui/Icon";

export const NotificationToggle = (): JSX.Element => {
  const { t } = useTranslation();
  const on = usePreferencesStore((s) => s.notificationsEnabled);
  const setOn = usePreferencesStore((s) => s.setNotificationsEnabled);
  const pushTokenStatus = usePreferencesStore((s) => s.pushTokenStatus);

  return (
    <View className="border-b border-gray-100 dark:border-gray-700 py-4">
      <View
        className="flex-row items-center justify-between"
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <View className="flex-1 pr-4">
          <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
            {t("settings.notifications.title", { defaultValue: "Push Notifications" })}
          </Text>
          <Text className="mt-1 text-body text-neutral dark:text-gray-400">
            {t("settings.notifications.desc", {
              defaultValue: "Receive alerts for logs and patterns.",
            })}
          </Text>
        </View>
        <Switch
          value={on}
          onValueChange={setOn}
          trackColor={{ false: "#D1D5DB", true: "#93C5FD" }}
          thumbColor={on ? "#2563EB" : "#F3F4F6"}
        />
      </View>

      {/* Debug UI for push token registration failures */}
      {pushTokenStatus && pushTokenStatus !== "synced" && (
        <View className="mt-3 flex-row items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 p-3">
          <Icon name="alert-circle" size={20} color="#D97706" />
          <View className="flex-1">
            <Text className="text-body font-semibold text-amber-900 dark:text-amber-200">
              {t("settings.notifications.errorTitle", { defaultValue: "Notification Setup Issue" })}
            </Text>
            <Text className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              {pushTokenStatus === "permission_denied"
                ? t("settings.notifications.errorPerm", {
                    defaultValue: "Please enable notifications in your phone's settings.",
                  })
                : pushTokenStatus === "not_a_device"
                  ? t("settings.notifications.errorSim", {
                      defaultValue: "Push notifications are not supported on simulators.",
                    })
                  : pushTokenStatus === "expo_go"
                    ? t("settings.notifications.errorExpo", {
                        defaultValue: "Push notifications require a standalone build, not Expo Go.",
                      })
                    : t("settings.notifications.errorGeneric", {
                        defaultValue: "Could not register device for notifications.",
                      })}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};
