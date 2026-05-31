import { Pressable, Text } from "react-native";
import { useColorScheme } from "nativewind";
import { useTranslation } from "react-i18next";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { Icon } from "@/components/ui/Icon";
import { getFirstName } from "@/utils/getFirstName";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const ActiveProfileBadge = (): JSX.Element | null => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const profileCount = useProfileStore((s) => s.profiles.length);
  const requestSelector = useProfileStore((s) => s.requestSelector);
  const { colorScheme } = useColorScheme();
  if (!profile) return null;

  const tappable = profileCount > 1;
  const isDark = colorScheme === "dark";
  const iconColor = isDark ? "#E5E7EB" : "#374151";
  const chevronColor = isDark ? "#9CA3AF" : "#6B7280";

  return (
    <Pressable
      onPress={tappable ? requestSelector : undefined}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : "text"}
      accessibilityLabel={
        tappable
          ? `Active profile: ${getFirstName(profile.name)}. Double tap to switch profile.`
          : `Active profile: ${getFirstName(profile.name)}`
      }
      accessibilityHint={tappable ? "Opens profile selector" : undefined}
      style={{ minHeight: TOUCH_TARGET_MIN }}
      className="flex-row items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-800"
    >
      <Icon name="person" size={16} color={iconColor} />
      <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
        {getFirstName(profile.name)}
        {t("profile.suffix") ? ` ${t("profile.suffix")}` : ""}
      </Text>
      {tappable && <Icon name="chevron-down" size={14} color={chevronColor} />}
    </Pressable>
  );
};
