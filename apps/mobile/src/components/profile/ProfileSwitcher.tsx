import { View, Text, Pressable, ScrollView } from "react-native";
import { useProfileStore } from "@/stores/profile.store";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const ProfileSwitcher = (): JSX.Element => {
  const profiles = useProfileStore((s) => s.profiles);
  const activeId = useProfileStore((s) => s.activeProfileId);
  // Either lock blocks the switch — logging mid-flow OR an active
  // SOS chain (phase4.md §D'.2). The store enforces; this just
  // dims the avatars so the disabled state is visible.
  const locked = useProfileStore((s) => s.profileLockedForLogging || s.profileLockedForSOS);
  const switchProfile = useProfileStore((s) => s.switchProfile);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="py-2">
      <View className="flex-row gap-3 px-4">
        {profiles.map((p) => {
          const isActive = p.id === activeId;
          return (
            <Pressable
              key={p.id}
              onPress={() => switchProfile(p.id)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: locked }}
              accessibilityLabel={`Switch to ${p.name}`}
              style={{ minWidth: TOUCH_TARGET_MIN }}
              className={`items-center ${locked ? "opacity-40" : ""}`}
            >
              <View
                className={`h-14 w-14 items-center justify-center rounded-full ${
                  isActive ? "border-4 border-primary" : "border-2 border-gray-300"
                }`}
                style={{ backgroundColor: p.avatarColor }}
              >
                <Text className="text-important font-bold text-white">
                  {p.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text className="mt-1 text-body" numberOfLines={1}>
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
};
