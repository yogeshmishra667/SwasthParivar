// Phase 3 — AI Chat: voice input button (phase3.md M.1).
//
// The `[+]` mic control in the chat input bar. Reuses the Phase 1 voice
// stack (expo-speech-recognition) but yields the RAW transcript — chat
// wants the spoken text, not a parsed glucose number. The native
// implementation is lazy-loaded behind the same Expo Go guard used by
// `components/logging/VoiceInput.tsx` (the native module crashes the
// bundle if imported under Expo Go on Android).

import { useEffect, useState, type ComponentType } from "react";
import { Pressable, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { isExpoGo } from "@/utils/runtime";

export interface VoiceButtonProps {
  onTranscribe: (text: string) => void;
  disabled?: boolean;
}

const voiceUnavailable = isExpoGo && Platform.OS === "android";

// Rendered when voice can't run (Expo Go on Android), while the native
// module is still loading, or when the input bar is disabled.
const InertMic = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Pressable
      disabled
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      accessibilityLabel={t("chat.voice")}
      className="min-h-touch min-w-touch items-center justify-center rounded-full opacity-40"
    >
      <Icon name="mic-off" size={24} color="#6B7280" />
    </Pressable>
  );
};

export const VoiceButton = ({ onTranscribe, disabled = false }: VoiceButtonProps): JSX.Element => {
  const [Native, setNative] = useState<ComponentType<VoiceButtonProps> | null>(null);

  useEffect(() => {
    if (voiceUnavailable) return;
    let cancelled = false;
    void import("./VoiceButtonNative").then((mod) => {
      if (!cancelled) setNative(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (voiceUnavailable || disabled || Native === null) return <InertMic />;
  return <Native onTranscribe={onTranscribe} disabled={disabled} />;
};
