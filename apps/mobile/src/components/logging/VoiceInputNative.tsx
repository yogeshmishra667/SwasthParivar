import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from "expo-speech-recognition";
import { parseVoiceTranscript, type VoiceParseResult } from "@swasth/domain-logic";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useProfileStore } from "@/stores/profile.store";
import { Icon } from "@/components/ui/Icon";
import { hapticSave } from "@/utils/haptics";
import { TIMEOUTS, TOUCH_TARGET_MIN } from "@/utils/constants";
import { logError, track } from "@/services/analytics";

interface Props {
  onParsed: (result: VoiceParseResult) => void;
  onFail: () => void;
}

const FAIL_THRESHOLD = 2;

type StatusKey = "tap" | "listen" | "noPermission" | "error";

const VoiceInputNative = ({ onParsed, onFail }: Props): JSX.Element => {
  const [recording, setRecording] = useState(false);
  const [statusKey, setStatusKey] = useState<StatusKey>("tap");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const failCount = useRef(0);
  const transcriptRef = useRef("");
  const confidenceRef = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = usePreferencesStore((s) => s.language);
  const lockForLogging = useProfileStore((s) => s.lockForLogging);
  const unlock = useProfileStore((s) => s.unlock);

  const stopAndUnlock = (): void => {
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
    unlock();
  };

  useEffect(() => () => stopAndUnlock(), []);

  useSpeechRecognitionEvent("result", (event) => {
    const top = event.results[0];
    if (!top) return;
    transcriptRef.current = top.transcript;
    if (typeof top.confidence === "number" && top.confidence > 0) {
      confidenceRef.current = top.confidence;
    }
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => stopAndUnlock(), TIMEOUTS.voiceSilenceMs);
  });

  useSpeechRecognitionEvent("end", () => {
    setRecording(false);
    unlock();
    finalizeAttempt();
  });

  useSpeechRecognitionEvent("error", (event) => {
    const code = event.error as ExpoSpeechRecognitionErrorCode | undefined;
    setRecording(false);
    unlock();
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    if (code === "not-allowed" || code === "service-not-allowed") {
      setStatusKey("noPermission");
      return;
    }
    if (
      code === "no-speech" ||
      code === "audio-capture" ||
      code === "speech-timeout" ||
      code === "aborted"
    ) {
      finalizeAttempt();
      return;
    }
    setStatusKey("error");
    setErrorMsg(event.message ?? code ?? "voice_error");
    onFail();
  });

  const finalizeAttempt = (): void => {
    const transcript = transcriptRef.current.trim();
    transcriptRef.current = "";
    const confidence = confidenceRef.current || 0.85;
    confidenceRef.current = 0;

    if (transcript.length === 0) {
      const next = failCount.current + 1;
      failCount.current = next;
      track("voice_attempt", {
        success: false,
        confidence: 0,
        fallback: next >= FAIL_THRESHOLD,
        colloquial_match: false,
        uncertainty_detected: false,
      });
      if (next >= FAIL_THRESHOLD) onFail();
      return;
    }

    const result = parseVoiceTranscript({
      transcript,
      confidence,
      capturedAtHourLocal: new Date().getHours(),
    });
    track("voice_attempt", {
      success: result.kind === "ok",
      confidence,
      fallback: false,
      colloquial_match: result.kind === "ok" ? result.colloquialMatch : false,
      uncertainty_detected: result.kind === "ok" ? result.uncertaintyDetected : false,
    });
    if (result.kind === "ok") {
      failCount.current = 0;
      onParsed(result);
      return;
    }
    const next = failCount.current + 1;
    failCount.current = next;
    if (next >= FAIL_THRESHOLD) onFail();
  };

  const start = async (): Promise<void> => {
    setStatusKey("listen");
    setErrorMsg(null);
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setStatusKey("noPermission");
        return;
      }
      lockForLogging();
      hapticSave();
      transcriptRef.current = "";
      confidenceRef.current = 0;
      setRecording(true);
      ExpoSpeechRecognitionModule.start({
        lang: language === "en" ? "en-IN" : "hi-IN",
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
        contextualStrings: ["sugar", "fasting", "post meal", "subah", "khane"],
      });
      silenceTimer.current = setTimeout(() => stopAndUnlock(), TIMEOUTS.voiceSilenceMs);
    } catch (err) {
      logError("VoiceInputNative.start", err);
      stopAndUnlock();
      setStatusKey("error");
      setErrorMsg(err instanceof Error ? err.message : "voice_start_failed");
      onFail();
    }
  };

  const status = (() => {
    switch (statusKey) {
      case "listen":
        return "Suna ja raha hai...";
      case "noPermission":
        return "Microphone permission chahiye — settings me allow karein.";
      case "error":
        return errorMsg ?? "Voice mein dikkat hai — numpad use karein.";
      case "tap":
      default:
        return "Bolne ke liye tap karein";
    }
  })();

  return (
    <View className="items-center gap-3">
      <Pressable
        onPress={() => {
          if (recording) {
            stopAndUnlock();
            return;
          }
          void start();
        }}
        accessibilityRole="button"
        accessibilityState={{ busy: recording }}
        accessibilityLabel="Tap to speak your glucose reading"
        className={`items-center justify-center rounded-full ${
          recording ? "bg-critical" : "bg-primary"
        }`}
        style={{
          width: TOUCH_TARGET_MIN * 2.5,
          height: TOUCH_TARGET_MIN * 2.5,
        }}
      >
        <Icon name={recording ? "stop" : "mic"} size={48} color="#FFFFFF" />
      </Pressable>
      <Text className="text-important text-center px-4">{status}</Text>
    </View>
  );
};

export default VoiceInputNative;
