import { View, Text } from "react-native";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { Icon } from "@/components/ui/Icon";

export const ActiveProfileBadge = (): JSX.Element | null => {
  const profile = useActiveProfile();
  if (!profile) return null;

  return (
    <View
      accessibilityLabel={`Active profile: ${profile.name}`}
      className="flex-row items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5"
    >
      <Icon name="person" size={16} color="#374151" />
      <Text className="text-important font-semibold">{profile.name} ji</Text>
    </View>
  );
};
