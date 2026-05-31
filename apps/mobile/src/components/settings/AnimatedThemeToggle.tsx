import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from "react-native-reanimated";
import { Icon } from "@/components/ui/Icon";
import { usePreferencesStore, type Theme } from "@/stores/preferences.store";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export const AnimatedThemeToggle = (): JSX.Element => {
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);

  // 0: light, 1: dark, 2: system
  const themeIndex = theme === "dark" ? 1 : theme === "system" ? 2 : 0;
  const progress = useSharedValue(themeIndex);

  useEffect(() => {
    progress.value = withSpring(themeIndex, {
      mass: 1,
      damping: 15,
      stiffness: 120,
    });
  }, [themeIndex, progress]);

  const toggleStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1, 2],
      ["#EFF6FF", "#1F2937", "#F3F4F6"], // light blue, dark gray, light gray (system)
    );

    return { backgroundColor };
  });

  const iconStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { rotate: `${progress.value * 120}deg` },
        { scale: withSpring(1, { damping: 12 }) },
      ],
    };
  });

  const handlePress = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(nextTheme);
  };

  const getIconName = () => {
    if (theme === "dark") return "moon";
    if (theme === "system") return "phone-portrait";
    return "sunny";
  };

  const getIconColor = () => {
    if (theme === "dark") return "#FBBF24";
    if (theme === "system") return "#6B7280";
    return "#F59E0B";
  };

  return (
    <Pressable
      onPress={handlePress}
      style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
      className="items-center justify-center rounded-full"
      accessibilityRole="button"
      accessibilityLabel={`Current Theme: ${theme}. Tap to change.`}
    >
      <Animated.View style={[styles.container, toggleStyle]}>
        <Animated.View style={iconStyle}>
          <Icon name={getIconName()} size={24} color={getIconColor()} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
