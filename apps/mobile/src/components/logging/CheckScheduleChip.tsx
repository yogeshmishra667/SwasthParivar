import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { usePreferencesStore } from "@/stores/preferences.store";
import { cadenceLabel } from "@/utils/nextReminder";

// Subtle chip rendered at the top of the Log input stage. Reminds the
// user of the cadence they configured — "Daily • 7:00 AM" — so the
// schedule feels intentional, not random. One row, soft surface, no
// CTA — pure orientation.
//
// Hides when notifications are off (no schedule to advertise).

export const CheckScheduleChip = (): JSX.Element | null => {
  const { t } = useTranslation();
  const notificationsEnabled = usePreferencesStore((s) => s.notificationsEnabled);
  const checkFrequency = usePreferencesStore((s) => s.checkFrequency);
  const reminderTime = usePreferencesStore((s) => s.reminderTime);

  if (!notificationsEnabled) return null;

  const cadence = cadenceLabel(checkFrequency, t);
  const time = reminderTime ?? "07:00";

  return (
    <View className="mx-4 mb-2 flex-row items-center gap-2 self-start rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
      <Icon name="notifications-outline" size={14} color="#6B7280" />
      <Text className="text-sm text-gray-700 dark:text-gray-300">
        {cadence} • {time}
      </Text>
    </View>
  );
};
