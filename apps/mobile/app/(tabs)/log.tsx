import { useState } from "react";
import { View, Text, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { v4 as uuidv4 } from "uuid";
import type { GlucoseReadingType } from "@swasth/shared-types";
import type { VoiceParseResult } from "@swasth/domain-logic";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { VoiceInput } from "@/components/logging/VoiceInput";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { UndoToast } from "@/components/shared/UndoToast";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { hapticSave } from "@/utils/haptics";
import { track } from "@/services/analytics";

type Stage = "input" | "confirm" | "saved";

export default function LogScreen(): JSX.Element {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [stage, setStage] = useState<Stage>("input");
  const [mode, setMode] = useState<"voice" | "numpad">("voice");
  const [parsed, setParsed] = useState<{
    value: number;
    type: GlucoseReadingType;
    uncertain: boolean;
  } | null>(null);
  const [voiceFailCount, setVoiceFailCount] = useState(0);
  const [undoVisible, setUndoVisible] = useState(false);

  const handleVoice = (result: VoiceParseResult): void => {
    if (result.kind !== "ok") return;
    setParsed({
      value: result.value,
      type: result.readingType,
      uncertain: result.requiresTypeConfirmation,
    });
    setStage("confirm");
  };

  const handleNumpad = (value: number): void => {
    setParsed({ value, type: "fasting", uncertain: true });
    setStage("confirm");
  };

  const save = async (type: GlucoseReadingType): Promise<void> => {
    if (!parsed || !userId) return;
    hapticSave();
    const clientUuid = uuidv4();
    try {
      await api.post("/readings/glucose", {
        clientUuid,
        valueMgDl: parsed.value,
        readingType: type,
        source: mode,
        measuredAtIso: new Date().toISOString(),
        userTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        version: 1,
      });
      track("reading_logged", {
        type,
        source: mode,
        value: parsed.value,
      });
      setUndoVisible(true);
      setStage("saved");
    } catch {
      Alert.alert("Save nahi ho paya", "Phone dhyan rakhein, data locally safe hai.");
    }
  };

  if (stage === "confirm" && parsed) {
    return (
      <ConfirmationScreen
        value={parsed.value}
        type={parsed.type}
        uncertainType={parsed.uncertain}
        onConfirm={(t) => void save(t)}
        onEdit={() => setStage("input")}
      />
    );
  }

  if (stage === "saved") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-white p-6">
        <Text className="text-hero">✅</Text>
        <Text className="text-important">Save ho gaya</Text>
        <Button label="Dashboard" onPress={() => router.replace("/(tabs)/dashboard")} />
        <UndoToast
          visible={undoVisible}
          message="Reading save hui"
          onUndo={() => {
            setUndoVisible(false);
            setStage("input");
          }}
          onHide={() => setUndoVisible(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 gap-6 bg-white p-6">
      <View className="items-end">
        <ActiveProfileBadge />
      </View>
      {mode === "voice" ? (
        <VoiceInput
          onParsed={handleVoice}
          onFail={() => {
            setVoiceFailCount((c) => c + 1);
            setMode("numpad");
          }}
        />
      ) : (
        <NumpadInput onSubmit={handleNumpad} />
      )}
      <Button
        label={mode === "voice" ? "Numpad use karein" : "Voice try karein"}
        variant="ghost"
        onPress={() => setMode((m) => (m === "voice" ? "numpad" : "voice"))}
      />
      {voiceFailCount >= 2 && (
        <Text className="text-body text-warning">
          Voice mein dikkat hai, numpad use karein.
        </Text>
      )}
    </SafeAreaView>
  );
}
