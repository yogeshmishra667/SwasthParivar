// Phase 3 — AI Chat: input bar (phase3.md M.1).
//
// Owns the draft text. When the daily free limit is exhausted
// (`dailyRemaining <= 0`) the input is replaced by the rate-limit
// message. When offline, send is disabled and an explanatory hint is
// shown — chat is online-only.

import { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { VoiceButton } from "./VoiceButton";
import { SendButton } from "./SendButton";
import type { ChatInputBarProps } from "./types";

export const ChatInputBar = ({
  onSend,
  disabled,
  dailyRemaining,
  isOffline,
}: ChatInputBarProps): JSX.Element => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Daily free-tier limit hit — no input, just the Hindi rate-limit copy.
  if (dailyRemaining <= 0) {
    return (
      <View className="border-t border-gray-200 px-4 py-3">
        <Text className="text-center text-body text-neutral">{t("chat.rateLimit")}</Text>
      </View>
    );
  }

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  };

  const inputBlocked = disabled || isOffline;
  const sendDisabled = inputBlocked || text.trim().length === 0;

  return (
    <View className="border-t border-gray-200 px-2 py-2">
      {isOffline ? (
        <Text className="px-2 pb-1 text-body text-neutral">{t("chat.offlineSend")}</Text>
      ) : null}
      <View className="flex-row items-end gap-1">
        {/* A finished voice transcript is appended to the draft text. */}
        <VoiceButton
          onTranscribe={(transcript) =>
            setText((prev) => (prev.trim().length > 0 ? `${prev} ${transcript}` : transcript))
          }
          disabled={inputBlocked}
        />
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!inputBlocked}
          multiline
          placeholder={t("chat.inputPlaceholder")}
          accessibilityLabel={t("chat.inputPlaceholder")}
          className="max-h-32 flex-1 rounded-2xl bg-gray-100 px-4 py-2 text-important text-gray-900"
        />
        <SendButton onPress={() => void send()} loading={sending} disabled={sendDisabled} />
      </View>
    </View>
  );
};
