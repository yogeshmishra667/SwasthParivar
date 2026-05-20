// Phase 3 — AI Chat: native voice-input button (expo-speech-recognition).
//
// Loaded only by `VoiceButton` when the native module is available.
// Toggles recording and hands the finished RAW transcript to
// `onTranscribe` — chat wants the spoken text verbatim, so unlike
// `VoiceInputNative` there is no glucose parsing here. Mirrors that
// component's permission / silence-timeout / cleanup handling.

import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "@/stores/preferences.store";
import { Icon } from "@/components/ui/Icon";
import { hapticSave } from "@/utils/haptics";
import { TIMEOUTS } from "@/utils/constants";
import { logError } from "@/services/analytics";
import type { VoiceButtonProps } from "./VoiceButton";

const VoiceButtonNative = ({ onTranscribe, disabled = false }: VoiceButtonProps): JSX.Element => {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const transcriptRef = useRef("");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = usePreferencesStore((s) => s.language);

  const stop = (): void => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // module may already be idle
    }
    setRecording(false);
  };

  // Unmount-only cleanup — stop any in-flight recognition.
  useEffect(() => () => stop(), []);

  useSpeechRecognitionEvent("result", (event) => {
    const top = event.results[0];
    if (!top) return;
    transcriptRef.current = top.transcript;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => stop(), TIMEOUTS.voiceSilenceMs);
  });

  useSpeechRecognitionEvent("end", () => {
    setRecording(false);
    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    if (text.length > 0) onTranscribe(text);
  });

  useSpeechRecognitionEvent("error", () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    setRecording(false);
  });

  const start = async (): Promise<void> => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return;
      hapticSave();
      transcriptRef.current = "";
      setRecording(true);
      ExpoSpeechRecognitionModule.start({
        lang: language === "en" ? "en-IN" : "hi-IN",
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
      });
      silenceTimer.current = setTimeout(() => stop(), TIMEOUTS.voiceSilenceMs);
    } catch (err) {
      logError("VoiceButtonNative.start", err);
      stop();
    }
  };

  return (
    <Pressable
      onPress={() => {
        if (recording) {
          stop();
          return;
        }
        void start();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ busy: recording, disabled }}
      accessibilityLabel={t("chat.voice")}
      className={`min-h-touch min-w-touch items-center justify-center rounded-full ${
        recording ? "bg-critical" : "active:opacity-60"
      }`}
    >
      <Icon name={recording ? "stop" : "mic"} size={24} color={recording ? "#FFFFFF" : "#2563EB"} />
    </Pressable>
  );
};

export default VoiceButtonNative;
