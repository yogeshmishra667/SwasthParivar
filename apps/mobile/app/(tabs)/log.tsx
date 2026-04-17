import { useState } from "react";
import { View, Text } from "react-native";
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
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { hapticSave } from "@/utils/haptics";
import { track } from "@/services/analytics";

type Stage = "input" | "confirm" | "saved";
type InputMode = "voice" | "numpad";

interface Parsed {
  value: number;
  type: GlucoseReadingType;
  uncertain: boolean;
}

export default function LogScreen(): JSX.Element {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [stage, setStage] = useState<Stage>("input");
  const [mode, setMode] = useState<InputMode>("voice");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaveError(null);
    try {
      await api.post("/readings/glucose", {
        clientUuid: uuidv4(),
        valueMgDl: parsed.value,
        readingType: type,
        source: mode,
        measuredAtIso: new Date().toISOString(),
        userTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        version: 1,
      });
      track("reading_logged", { type, source: mode, value: parsed.value });
      setUndoVisible(true);
      setStage("saved");
    } catch {
      setSaveError("Save nahi ho paya — data locally safe hai, sync baad mein hoga.");
    }
  };

  if (stage === "confirm" && parsed) {
    return (
      <ConfirmationScreen
        value={parsed.value}
        type={parsed.type}
        uncertainType={parsed.uncertain}
        onConfirm={(t) => void save(t)}
        onEdit={() => {
          setSaveError(null);
          setStage("input");
        }}
      />
    );
  }

  if (stage === "saved") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-white p-6">
        <Icon name="checkmark-circle" size={72} color="#16A34A" accessibilityLabel="Saved" />
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
        <VoiceInput onParsed={handleVoice} onFail={() => setMode("numpad")} />
      ) : (
        <NumpadInput onSubmit={handleNumpad} />
      )}

      <Button
        label={mode === "voice" ? "Numpad use karein" : "Voice try karein"}
        variant="ghost"
        onPress={() => setMode((m) => (m === "voice" ? "numpad" : "voice"))}
      />

      {saveError !== null && (
        <Text className="text-body text-warning">{saveError}</Text>
      )}
    </SafeAreaView>
  );
}
