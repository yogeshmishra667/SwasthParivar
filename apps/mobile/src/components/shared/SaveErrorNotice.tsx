import { Text, View, useColorScheme } from "react-native";

import { FONT_SIZE } from "@/utils/constants";

/**
 * "Not saved" message on a logging screen. Announced by screen readers,
 * 16px (important text) and AAA contrast in both themes: red-800 on red-50
 * ≈ 8:1, red-100 on red-900 ≈ 8.5:1.
 */
export const SaveErrorNotice = ({ message }: { message: string }): JSX.Element => {
  const isDark = useColorScheme() === "dark";
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: isDark ? "#7F1D1D" : "#FEF2F2",
      }}
    >
      <Text
        style={{
          color: isDark ? "#FEE2E2" : "#991B1B",
          fontSize: FONT_SIZE.important,
          textAlign: "center",
        }}
      >
        {message}
      </Text>
    </View>
  );
};
