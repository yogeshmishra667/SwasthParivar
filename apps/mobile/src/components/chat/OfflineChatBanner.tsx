// Phase 3 — AI Chat: offline banner (phase3.md M.1).
// Chat is online-only (unlike glucose logging). When offline this
// full-width banner makes the limitation explicit instead of letting
// a send silently fail.

import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";

interface OfflineChatBannerProps {
  isOffline: boolean;
}

export const OfflineChatBanner = ({ isOffline }: OfflineChatBannerProps): JSX.Element | null => {
  const { t } = useTranslation();
  if (!isOffline) return null;
  return (
    // gray-700 + white = ~9:1 contrast, safe in normal and high-contrast modes.
    <View className="bg-gray-700 px-4 py-2.5" accessibilityRole="alert">
      <Text className="text-body font-semibold text-white">{t("chat.offlineBanner")}</Text>
    </View>
  );
};
