import { useState } from "react";
import { View, Text, Pressable, Modal, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "@/stores/preferences.store";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const ReminderTimePicker = (): JSX.Element => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const time = usePreferencesStore((s) => s.reminderTime);
  const setTime = usePreferencesStore((s) => s.setReminderTime);

  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  const handleHourChange = (text: string) => {
    const numeric = text.replace(/[^0-9]/g, "");
    if (numeric.length === 2 && parseInt(numeric, 10) > 23) {
      setHours("23");
    } else {
      setHours(numeric);
    }
  };

  const handleMinuteChange = (text: string) => {
    const numeric = text.replace(/[^0-9]/g, "");
    if (numeric.length === 2 && parseInt(numeric, 10) > 59) {
      setMinutes("59");
    } else {
      setMinutes(numeric);
    }
  };

  const handleSave = () => {
    const h = hours.padStart(2, "0");
    const m = minutes.padStart(2, "0");
    if (h && m) {
      setTime(`${h}:${m}`);
    }
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-700 py-4"
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <View>
          <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
            {t("settings.reminderTime.title", { defaultValue: "Daily Reminder" })}
          </Text>
          <Text className="mt-1 text-body text-neutral dark:text-gray-400">
            {time
              ? t("settings.reminderTime.value", { time, defaultValue: "{{time}}" })
              : t("settings.reminderTime.off", { defaultValue: "Off" })}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color="#9CA3AF" />
      </Pressable>

      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="w-full rounded-t-3xl bg-white p-6 dark:bg-gray-900">
            <Text className="mb-4 text-hero font-bold text-gray-900 dark:text-white">
              {t("settings.reminderTime.title", { defaultValue: "Daily Reminder" })}
            </Text>

            <View className="items-center py-8">
              <View className="flex-row items-center gap-4">
                <TextInput
                  value={hours}
                  onChangeText={handleHourChange}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel={t("settings.reminderTime.hoursLabel", {
                    defaultValue: "Hours",
                  })}
                  className="w-20 rounded-xl bg-gray-100 p-4 text-center text-hero font-bold text-gray-900 dark:bg-gray-800 dark:text-white"
                  placeholder="07"
                  placeholderTextColor="#9CA3AF"
                />
                <Text className="text-hero font-bold text-gray-900 dark:text-white">:</Text>
                <TextInput
                  value={minutes}
                  onChangeText={handleMinuteChange}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel={t("settings.reminderTime.minutesLabel", {
                    defaultValue: "Minutes",
                  })}
                  className="w-20 rounded-xl bg-gray-100 p-4 text-center text-hero font-bold text-gray-900 dark:bg-gray-800 dark:text-white"
                  placeholder="00"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
              <Text className="mt-4 text-body text-neutral dark:text-gray-400">
                {t("settings.reminderTime.format", {
                  defaultValue: "24-hour format (e.g. 07:00 or 19:30)",
                })}
              </Text>
            </View>

            <View className="flex-row gap-4 mt-2">
              <Pressable
                onPress={() => {
                  setTime(null);
                  setOpen(false);
                }}
                className="flex-1 items-center justify-center rounded-xl bg-gray-100 p-3 dark:bg-gray-800"
                style={{ minHeight: TOUCH_TARGET_MIN }}
              >
                <Text className="text-important font-semibold text-critical">
                  {t("settings.reminderTime.disable", { defaultValue: "Disable" })}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                className="flex-1 items-center justify-center rounded-xl bg-primary p-3"
                style={{ minHeight: TOUCH_TARGET_MIN }}
              >
                <Text className="text-important font-semibold text-white">
                  {t("common.save", { defaultValue: "Save" })}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};
