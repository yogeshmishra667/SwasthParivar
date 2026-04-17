import { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { v4 as uuidv4 } from "uuid";
import { isCriticalGlucose } from "@swasth/shared-types";
import type { GlucoseReadingType } from "@swasth/shared-types";
import type { VoiceParseResult } from "@swasth/domain-logic";
import { useTranslation } from "react-i18next";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { VoiceInput } from "@/components/logging/VoiceInput";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { CriticalAlert } from "@/components/logging/CriticalAlert";
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

interface SaveResponse {
  success: boolean;
  data: {
    streak: { currentStreakDays: number; milestoneReached: string | null };
    feedback: { tone: string; messageKey: string; params: Record<string, unknown> };
    critical: { isCritical: boolean; direction?: "low" | "high" };
  };
}

export default function LogScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [stage, setStage] = useState<Stage>("input");
  const [mode, setMode] = useState<InputMode>("voice");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState(0);
  const [criticalAlert, setCriticalAlert] = useState<{
    visible: boolean;
    value: number;
    direction: "low" | "high";
  }>({ visible: false, value: 0, direction: "low" });

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
      const res = await api.post<SaveResponse>("/readings/glucose", {
        clientUuid: uuidv4(),
        valueMgDl: parsed.value,
        readingType: type,
        source: mode,
        measuredAt: new Date().toISOString(),
        version: 1,
      });
      track("reading_logged", { type, source: mode, value: parsed.value });

      const { streak, feedback, critical } = res.data;
      setStreakDays(streak.currentStreakDays);
      setFeedbackMsg(t(`feedback.${feedback.tone}`, { defaultValue: t("logging.saved") }));

      if (critical.isCritical && critical.direction) {
        setCriticalAlert({ visible: true, value: parsed.value, direction: critical.direction });
        track("critical_bypass_triggered", { value: parsed.value });
      }

      setUndoVisible(true);
      setStage("saved");
    } catch {
      if (isCriticalGlucose(parsed.value)) {
        const dir = parsed.value < 65 ? "low" : "high";
        setCriticalAlert({ visible: true, value: parsed.value, direction: dir });
        track("critical_bypass_triggered", { value: parsed.value });
      }
      setSaveError(t("logging.saveFailed"));
    }
  };

  if (stage === "confirm" && parsed) {
    return (
      <>
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
        <CriticalAlert
          visible={criticalAlert.visible}
          value={criticalAlert.value}
          direction={criticalAlert.direction}
          contactName="Emergency"
          contactPhone="112"
          onDismiss={() => setCriticalAlert((c) => ({ ...c, visible: false }))}
        />
      </>
    );
  }

  if (stage === "saved") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-white p-6">
        <Icon name="checkmark-circle" size={72} color="#16A34A" accessibilityLabel="Saved" />
        <Text className="text-important">{feedbackMsg ?? t("logging.saved")}</Text>
        {streakDays > 0 && (
          <View className="flex-row items-center gap-2">
            <Icon name="flame" size={20} color="#F59E0B" />
            <Text className="text-body">{t("logging.streakCount", { count: streakDays })}</Text>
          </View>
        )}
        <Button label={t("common.dashboard")} onPress={() => router.replace("/(tabs)/dashboard")} />
        <UndoToast
          visible={undoVisible}
          message={t("logging.readingSaved")}
          onUndo={() => {
            setUndoVisible(false);
            setStage("input");
          }}
          onHide={() => setUndoVisible(false)}
        />
        <CriticalAlert
          visible={criticalAlert.visible}
          value={criticalAlert.value}
          direction={criticalAlert.direction}
          contactName="Emergency"
          contactPhone="112"
          onDismiss={() => setCriticalAlert((c) => ({ ...c, visible: false }))}
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
        label={mode === "voice" ? t("logging.useNumpad") : t("logging.useVoice")}
        variant="ghost"
        onPress={() => setMode((m) => (m === "voice" ? "numpad" : "voice"))}
      />

      {saveError !== null && (
        <Text className="text-body text-warning">{saveError}</Text>
      )}
    </SafeAreaView>
  );
}
