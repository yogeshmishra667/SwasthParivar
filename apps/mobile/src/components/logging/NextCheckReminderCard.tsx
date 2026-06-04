import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { nextReminderAt, formatNextReminder } from "@/utils/nextReminder";

// Post-save habit-loop card. Shown on the Log screen "saved" stage so
// the user finishes their save with "system has the next one covered".
//
// Hides itself entirely when notifications are off or the cadence /
// time aren't set — there's nothing meaningful to promise.
//
// Copy is condition-aware so a hypertension-only profile sees "BP",
// a diabetes profile sees "Sugar", and a multi-condition profile sees
// "Health" — matching the check-reminders notification copy.

export const NextCheckReminderCard = (): JSX.Element | null => {
  const { t } = useTranslation();
  const notificationsEnabled = usePreferencesStore((s) => s.notificationsEnabled);
  const checkFrequency = usePreferencesStore((s) => s.checkFrequency);
  const reminderTime = usePreferencesStore((s) => s.reminderTime);
  const profile = useActiveProfile();

  const nextAt = nextReminderAt({
    enabled: notificationsEnabled,
    frequency: checkFrequency,
    reminderTime,
  });
  if (!nextAt) return null;

  const hasGlucose = !profile?.conditions || profile.conditions.includes("diabetes");
  const hasBP = profile?.conditions?.includes("hypertension") ?? false;
  const subjectKey =
    hasGlucose && hasBP
      ? "nextReminder.subject.both"
      : hasBP
        ? "nextReminder.subject.bp"
        : "nextReminder.subject.sugar";
  const subject = t(subjectKey, {
    defaultValue: hasGlucose && hasBP ? "Sugar aur BP" : hasBP ? "BP" : "Sugar",
  });

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 dark:border-blue-900/60 dark:bg-blue-950/30">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-white dark:bg-blue-900/60">
        <Icon name="notifications" size={20} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-body text-gray-700 dark:text-gray-300">
          {t("nextReminder.label", {
            subject,
            defaultValue: `Agla ${subject} check reminder`,
          })}
        </Text>
        <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
          {formatNextReminder(nextAt, t)}
        </Text>
      </View>
    </View>
  );
};
