// Phase 3 — AI Chat: send button (phase3.md M.1).
// 48dp; shows a spinner while a send is in flight and is disabled when
// there is nothing to send.

import { Pressable, Text, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";

interface SendButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled?: boolean;
}

export const SendButton = ({
  onPress,
  loading,
  disabled = false,
}: SendButtonProps): JSX.Element => {
  const { t } = useTranslation();
  const isDisabled = loading || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={t("chat.send")}
      accessibilityState={{ disabled: isDisabled }}
      className={`min-h-touch min-w-touch items-center justify-center rounded-2xl px-4 ${
        isDisabled ? "bg-gray-300" : "bg-primary active:opacity-80"
      }`}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text className="text-important font-semibold text-white">{t("chat.send")}</Text>
      )}
    </Pressable>
  );
};
