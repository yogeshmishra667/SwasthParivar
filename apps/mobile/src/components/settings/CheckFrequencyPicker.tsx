import { useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "@/stores/preferences.store";
import { CHECK_FREQUENCY_OPTIONS } from "@/utils/checkFrequency";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const CheckFrequencyPicker = (): JSX.Element => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const freq = usePreferencesStore((s) => s.checkFrequency);
  const setFreq = usePreferencesStore((s) => s.setCheckFrequency);

  const selectedOpt =
    CHECK_FREQUENCY_OPTIONS.find((o) => o.value === freq) ?? CHECK_FREQUENCY_OPTIONS[0]!;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-700 py-4"
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <View>
          <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
            {t("settings.checkFrequency.title", { defaultValue: "Sugar Check Frequency" })}
          </Text>
          <Text className="mt-1 text-body text-neutral dark:text-gray-400">
            {t(selectedOpt.labelKey, { defaultValue: selectedOpt.value })}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color="#9CA3AF" />
      </Pressable>

      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="w-full rounded-t-3xl bg-white p-6 dark:bg-gray-900">
            <Text className="mb-4 text-hero font-bold text-gray-900 dark:text-white">
              {t("settings.checkFrequency.title", { defaultValue: "Sugar Check Frequency" })}
            </Text>
            <ScrollView className="max-h-96">
              {CHECK_FREQUENCY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setFreq(opt.value);
                    setOpen(false);
                  }}
                  className={`flex-row items-center justify-between py-4 border-b border-gray-100 dark:border-gray-700 ${
                    freq === opt.value ? "bg-blue-50/50 dark:bg-blue-900/30" : ""
                  }`}
                  style={{ minHeight: TOUCH_TARGET_MIN }}
                >
                  <View className="flex-row items-center gap-3">
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-full ${freq === opt.value ? "bg-blue-100 dark:bg-blue-900" : "bg-gray-100 dark:bg-gray-700"}`}
                    >
                      <Icon
                        name="calendar-outline"
                        size={20}
                        color={freq === opt.value ? "#2563EB" : "#6B7280"}
                      />
                    </View>
                    <Text
                      className={`text-important font-semibold ${freq === opt.value ? "text-primary dark:text-blue-400" : "text-gray-900 dark:text-gray-200"}`}
                    >
                      {t(opt.labelKey, { defaultValue: opt.value })}
                    </Text>
                  </View>
                  {freq === opt.value && <Icon name="checkmark" size={20} color="#2563EB" />}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              className="mt-4 items-center justify-center rounded-xl bg-gray-100 p-3 dark:bg-gray-800"
              style={{ minHeight: TOUCH_TARGET_MIN }}
            >
              <Text className="text-important font-semibold text-gray-900 dark:text-gray-200">
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
};
