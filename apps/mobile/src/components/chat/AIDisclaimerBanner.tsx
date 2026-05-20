// Phase 3 — AI Chat: persistent disclaimer banner (phase3.md M.1).
// "AI hai — doctor nahi." Dismissable per session (returns next
// session). Dark text on light amber for WCAG-AA contrast.

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

interface AIDisclaimerBannerProps {
  onDismiss: () => void;
}

export const AIDisclaimerBanner = ({ onDismiss }: AIDisclaimerBannerProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center border-b border-amber-200 bg-amber-50 px-4 py-2"
      accessibilityRole="alert"
    >
      <Text className="flex-1 text-body text-amber-900">⚠️ {t("chat.disclaimer")}</Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("chat.flagDialog.cancel")}
        className="min-h-touch min-w-touch items-center justify-center active:opacity-60"
        hitSlop={8}
      >
        <Text className="text-important font-semibold text-amber-900">✕</Text>
      </Pressable>
    </View>
  );
};
