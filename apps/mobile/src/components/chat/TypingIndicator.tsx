// Phase 3 — AI Chat: assistant typing indicator (phase3.md M.1).
// Shows "AI soch raha hai…" while a response is in flight. After a 12s
// timeout it swaps to a retry prompt — the retry resends via the same
// idempotent clientUuid, so a replay is safe.

import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

const TYPING_TIMEOUT_MS = 12_000;

interface TypingIndicatorProps {
  visible: boolean;
  onRetry: () => void;
}

export const TypingIndicator = ({ visible, onRetry }: TypingIndicatorProps): JSX.Element | null => {
  const { t } = useTranslation();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!visible) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), TYPING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [visible]);

  if (!visible) return null;

  if (timedOut) {
    return (
      <View className="my-1 flex-row items-center px-4" accessibilityRole="alert">
        <Text className="flex-1 text-body text-neutral">{t("chat.typingTimeout")}</Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("chat.retry")}
          className="min-h-touch items-center justify-center rounded-2xl bg-primary px-4 active:opacity-80"
        >
          <Text className="text-important font-semibold text-white">{t("chat.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      className="my-2 ml-4 self-start rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-3"
      accessibilityRole="text"
    >
      <Text className="text-body text-neutral">{t("chat.typing")}</Text>
    </View>
  );
};
