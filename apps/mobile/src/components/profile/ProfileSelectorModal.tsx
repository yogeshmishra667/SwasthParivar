import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useProfileStore } from "@/stores/profile.store";
import { getFirstName } from "@/utils/getFirstName";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { Icon } from "@/components/ui/Icon";

export const ProfileSelectorModal = (): JSX.Element | null => {
  const { t } = useTranslation();
  const visible = useProfileStore((s) => s.selectorRequired);
  const profiles = useProfileStore((s) => s.profiles);
  const activeId = useProfileStore((s) => s.activeProfileId);
  const switchProfile = useProfileStore((s) => s.switchProfile);
  const dismiss = useProfileStore((s) => s.dismissSelector);

  if (!visible || profiles.length === 0) return null;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={dismiss}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="w-full rounded-t-3xl bg-white dark:bg-gray-900 p-6">
          <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
            {t("profileSelector.title")}
          </Text>
          <Text className="mt-1 text-body text-neutral dark:text-gray-400">
            {t("profileSelector.subtitle")}
          </Text>

          <ScrollView className="mt-4 max-h-80">
            {profiles.map((p) => {
              const isActive = p.id === activeId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    switchProfile(p.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${getFirstName(p.name)}`}
                  style={{ minHeight: TOUCH_TARGET_MIN }}
                  className={`my-1 flex-row items-center gap-3 rounded-xl border p-3 ${
                    isActive
                      ? "border-primary bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <View
                    className="h-12 w-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: p.avatarColor }}
                  >
                    <Text className="text-important font-bold text-white">
                      {p.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text className="flex-1 text-important font-semibold text-gray-900 dark:text-gray-100">
                    {getFirstName(p.name)}
                  </Text>
                  {isActive && <Icon name="checkmark-circle" size={22} color="#2563EB" />}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={dismiss}
            style={{ minHeight: TOUCH_TARGET_MIN }}
            className="mt-4 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 p-3"
            accessibilityRole="button"
          >
            <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
              {t("profileSelector.keepCurrent")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};
