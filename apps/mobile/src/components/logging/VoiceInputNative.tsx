import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from "expo-speech-recognition";
import {
  parseCardiacVoiceTranscript,
  parseRespiratoryVoiceTranscript,
  parseVoiceTranscript,
  type NumericVoiceParseResult,
  type VoiceParseResult,
} from "@swasth/domain-logic";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "@/stores/preferences.store";
import { useProfileStore } from "@/stores/profile.store";
import { Icon } from "@/components/ui/Icon";
import { hapticSave } from "@/utils/haptics";
import { TIMEOUTS, TOUCH_TARGET_MIN } from "@/utils/constants";
import { logError, track } from "@/services/analytics";
import type { VoiceInputProps } from "./VoiceInput";

const FAIL_THRESHOLD = 2;

type StatusKey = "tap" | "listen" | "noPermission" | "error";

// Per-mode contextual strings push the speech-recognition engine toward
// the vocabulary we expect to hear, so "dil ki dhadkan" / "peak flow"
// don't fall through to a generic transcription. The glucose hint list
// is unchanged from Phase 1.
const CONTEXTUAL_STRINGS: Record<VoiceInputProps["mode"], readonly string[]> = {
  glucose: ["sugar", "fasting", "post meal", "subah", "khane"],
  cardiac: ["dil", "dhadkan", "heart", "pulse", "heart rate"],
  respiratory: ["peak flow", "saans", "breathing", "asthma", "inhaler"],
};

const VoiceInputNative = (props: VoiceInputProps): JSX.Element => {
  const { mode, onFail } = props;
  const { t } = useTranslation();
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

  // Unmount-only cleanup; intentionally excludes stopAndUnlock to prevent re-firing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Dispatch into the right pure parser based on mode. Glucose stays
  // byte-identical with Phase 1 — same call site, same shape. Cardiac /
  // respiratory route through the shared numeric parser via their thin
  // wrappers from `@swasth/domain-logic`.
  const parseTranscript = (
    transcript: string,
    confidence: number,
  ): {
    result: VoiceParseResult | NumericVoiceParseResult;
    success: boolean;
    colloquialMatch: boolean;
    uncertaintyDetected: boolean;
  } => {
    if (mode === "glucose") {
      const result = parseVoiceTranscript({
        transcript,
        confidence,
        capturedAtHourLocal: new Date().getHours(),
      });
      return {
        result,
        success: result.kind === "ok",
        colloquialMatch: result.kind === "ok" ? result.colloquialMatch : false,
        uncertaintyDetected: result.kind === "ok" ? result.uncertaintyDetected : false,
      };
    }
    const result =
      mode === "cardiac"
        ? parseCardiacVoiceTranscript({ transcript, confidence })
        : parseRespiratoryVoiceTranscript({ transcript, confidence });
    return {
      result,
      success: result.kind === "ok",
      colloquialMatch: result.kind === "ok" ? result.colloquialMatch : false,
      uncertaintyDetected: result.kind === "ok" ? result.uncertaintyDetected : false,
    };
  };

  const finalizeAttempt = (): void => {
    const transcript = transcriptRef.current.trim();
    transcriptRef.current = "";
    const confidence = confidenceRef.current || 0.85;
    confidenceRef.current = 0;

    if (transcript.length === 0) {
      const next = failCount.current + 1;
      failCount.current = next;
      track("voice_attempt", {
        surface: mode,
        success: false,
        confidence: 0,
        fallback: next >= FAIL_THRESHOLD,
        colloquial_match: false,
        uncertainty_detected: false,
      });
      if (next >= FAIL_THRESHOLD) onFail();
      return;
    }

    const dispatch = parseTranscript(transcript, confidence);
    track("voice_attempt", {
      surface: mode,
      success: dispatch.success,
      confidence,
      fallback: false,
      colloquial_match: dispatch.colloquialMatch,
      uncertainty_detected: dispatch.uncertaintyDetected,
    });
    if (dispatch.success) {
      failCount.current = 0;
      // The discriminated union over `mode` keeps each branch's onParsed
      // typed correctly without runtime checks. Glucose carries the
      // extra reading-type axis so the cast is required; the numeric
      // branch is a structural supertype of the union and needs none.
      if (props.mode === "glucose") {
        props.onParsed(dispatch.result as VoiceParseResult);
      } else {
        props.onParsed(dispatch.result);
      }
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
        contextualStrings: [...CONTEXTUAL_STRINGS[mode]],
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
        return t("voice.statusListen");
      case "noPermission":
        return t("voice.statusNoPermission");
      case "error":
        return errorMsg ?? t("voice.statusError");
      case "tap":
      default:
        return t("voice.statusTap");
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
        accessibilityLabel={t(`voice.${mode}.accessibilityLabel`)}
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
      <Text className="text-important text-center px-4 text-gray-900 dark:text-gray-100">
        {status}
      </Text>
      {(statusKey === "tap" || statusKey === "listen") && (
        <Text className="text-center px-4 text-gray-500" style={{ fontSize: 13 }}>
          {t(`voice.${mode}.exampleHint`)}
        </Text>
      )}
    </View>
  );
};

export default VoiceInputNative;
