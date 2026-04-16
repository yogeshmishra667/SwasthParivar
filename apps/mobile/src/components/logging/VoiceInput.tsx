import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { parseVoiceTranscript, type VoiceParseResult } from "@swasth/domain-logic";
import { useProfileStore } from "@/stores/profile.store";
import { hapticSave } from "@/utils/haptics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { track } from "@/services/analytics";

interface VoiceInputProps {
  onParsed: (result: VoiceParseResult) => void;
  onFail: () => void;
}

export const VoiceInput = ({ onParsed, onFail }: VoiceInputProps): JSX.Element => {
  const [recording, setRecording] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const lockForLogging = useProfileStore((s) => s.lockForLogging);
  const unlock = useProfileStore((s) => s.unlock);

  const start = async (): Promise<void> => {
    lockForLogging();
    setRecording(true);
    hapticSave();
    // TODO: integrate expo-speech-recognition here.
    // For now this is a dev stub that simulates a successful parse of a sample transcript.
    setTimeout(() => {
      const result = parseVoiceTranscript({
        transcript: "aaj sugar 140 aayi",
        confidence: 0.8,
        capturedAtHourLocal: new Date().getHours(),
      });
      track("voice_attempt", {
        success: result.kind === "ok",
        confidence: 0.8,
        fallback: false,
        colloquial_match: result.kind === "ok" ? result.colloquialMatch : false,
        uncertainty_detected: result.kind === "ok" ? result.uncertaintyDetected : false,
      });
      if (result.kind === "ok") {
        onParsed(result);
      } else {
        const next = attemptCount + 1;
        setAttemptCount(next);
        if (next >= 2) onFail();
      }
      setRecording(false);
      unlock();
    }, 400);
  };

  return (
    <View className="items-center gap-3">
      <Pressable
        onPress={() => void start()}
        accessibilityRole="button"
        accessibilityLabel="Hold to speak your glucose reading"
        className={`items-center justify-center rounded-full ${
          recording ? "bg-critical" : "bg-primary"
        }`}
        style={{
          width: TOUCH_TARGET_MIN * 2.5,
          height: TOUCH_TARGET_MIN * 2.5,
        }}
      >
        <Text className="text-hero">🎙️</Text>
      </Pressable>
      <Text className="text-important">
        {recording ? "Suna ja raha hai..." : "Bolne ke liye tap karein"}
      </Text>
    </View>
  );
};
