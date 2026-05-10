import { Pressable, Text } from "react-native";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const ActiveProfileBadge = (): JSX.Element | null => {
  const profile = useActiveProfile();
  const profileCount = useProfileStore((s) => s.profiles.length);
  const requestSelector = useProfileStore((s) => s.requestSelector);
  if (!profile) return null;

  const tappable = profileCount > 1;

  return (
    <Pressable
      onPress={tappable ? requestSelector : undefined}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : "text"}
      accessibilityLabel={
        tappable
          ? `Active profile: ${profile.name}. Double tap to switch profile.`
          : `Active profile: ${profile.name}`
      }
      accessibilityHint={tappable ? "Opens profile selector" : undefined}
      style={{ minHeight: TOUCH_TARGET_MIN }}
      className="flex-row items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5"
    >
      <Icon name="person" size={16} color="#374151" />
      <Text className="text-important font-semibold">{profile.name} ji</Text>
      {tappable && <Icon name="chevron-down" size={14} color="#6B7280" />}
    </Pressable>
  );
};
