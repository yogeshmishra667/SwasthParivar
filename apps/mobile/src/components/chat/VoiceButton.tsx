// Phase 3 — AI Chat: voice input button (phase3.md M.1).
//
// The `[+]` mic control in the input bar. This is the presentational
// control; the speech-to-text engine wiring (expo-speech-recognition,
// reusing the lazy-load + Expo Go guard pattern from
// `components/logging/VoiceInputNative.tsx`) is connected by the chat
// screen, which owns the transcript → input-text flow. `onTranscribe`
// is the callback the STT layer invokes with a finished transcript.

import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

interface VoiceButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export const VoiceButton = ({ onPress, disabled = false }: VoiceButtonProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("chat.voice")}
      accessibilityState={{ disabled }}
      className={`min-h-touch min-w-touch items-center justify-center rounded-full ${
        disabled ? "opacity-40" : "active:opacity-60"
      }`}
    >
      <Icon name="mic" size={24} color="#2563EB" />
    </Pressable>
  );
};
