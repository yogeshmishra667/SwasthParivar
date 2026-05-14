import { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
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
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { saveGlucoseReading } from "@/services/readings";
import { useActiveProfile } from "@/hooks/useActiveProfile";
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
  const { t } = useTranslation();
  const router = useRouter();
  const activeProfile = useActiveProfile();
  const userId = activeProfile?.id ?? null;
  const [stage, setStage] = useState<Stage>("input");
  const [mode, setMode] = useState<InputMode>("voice");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [lastReadingId, setLastReadingId] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
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

  const save = async (type: GlucoseReadingType, context: "normal" | "festive"): Promise<void> => {
    if (!parsed || !userId) return;
    hapticSave();
    setSaveError(null);

    const result = await saveGlucoseReading({
      userId,
      valueMgDl: parsed.value,
      readingType: type,
      context,
      // `mode` is the input affordance (voice|numpad). Server `source`
      // is broader (manual|voice|device); numpad maps to manual.
      source: mode === "voice" ? "voice" : "manual",
      measuredAtIso: new Date().toISOString(),
    });

    if (result.kind === "synced") {
      setLastReadingId(result.readingId);
      setStreakDays(result.streak.currentStreakDays);
      setFeedbackMsg(t(`feedback.${result.feedback.tone}`, { defaultValue: t("logging.saved") }));
      setSavedOffline(false);
      if (result.critical.isCritical && result.critical.direction) {
        setCriticalAlert({
          visible: true,
          value: parsed.value,
          direction: result.critical.direction,
        });
        track("critical_bypass_triggered", { value: parsed.value });
      }
      setUndoVisible(true);
      setStage("saved");
      return;
    }

    if (result.kind === "queued") {
      // Offline path — queued in WatermelonDB; the drain hook will
      // push it later. Make the offline status clear.
      setLastReadingId(null);
      setSavedOffline(true);
      setStreakDays(0);
      setFeedbackMsg(t("logging.savedOffline"));
      // Critical-value safety still fires from the local check —
      // patient shouldn't lose the alert just because they're offline.
      if (isCriticalGlucose(parsed.value)) {
        const dir = parsed.value < 65 ? "low" : "high";
        setCriticalAlert({ visible: true, value: parsed.value, direction: dir });
        track("critical_bypass_triggered", { value: parsed.value });
      }
      setStage("saved");
      return;
    }

    // Server rejected the reading (4xx, validation, auth, conflict).
    // Critical-value alert still fires regardless of rejection reason.
    if (isCriticalGlucose(parsed.value)) {
      const dir = parsed.value < 65 ? "low" : "high";
      setCriticalAlert({ visible: true, value: parsed.value, direction: dir });
      track("critical_bypass_triggered", { value: parsed.value });
    }
    setSaveError(t("logging.saveFailed"));
  };

  if (stage === "confirm" && parsed) {
    return (
      <>
        <ConfirmationScreen
          value={parsed.value}
          type={parsed.type}
          uncertainType={parsed.uncertain}
          onConfirm={(t, ctx) => void save(t, ctx)}
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
    const resetForNext = (): void => {
      setUndoVisible(false);
      setLastReadingId(null);
      setParsed(null);
      setFeedbackMsg(null);
      setStreakDays(0);
      setSavedOffline(false);
      setSaveError(null);
      setMode("voice");
      setStage("input");
    };

    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-hero font-bold">
            {t("logging.savedTitle", { defaultValue: "Saved" })}
          </Text>
          <ActiveProfileBadge />
        </View>

        <View className="flex-1 justify-center gap-4 px-4">
          <Card>
            <View className="items-center gap-3 py-2">
              <Icon
                name={savedOffline ? "cloud-offline" : "checkmark-circle"}
                size={64}
                color={savedOffline ? "#D97706" : "#16A34A"}
                accessibilityLabel={savedOffline ? "Saved locally" : "Saved"}
              />
              {parsed && (
                <Text className="text-hero font-bold">
                  {parsed.value} <Text className="text-body font-normal text-neutral">mg/dL</Text>
                </Text>
              )}
              {feedbackMsg !== null && (
                <Text className="text-important text-center">{feedbackMsg}</Text>
              )}
              {streakDays > 0 && (
                <View className="flex-row items-center gap-2">
                  <Icon name="flame" size={20} color="#F59E0B" />
                  <Text className="text-body">
                    {t("logging.streakCount", { count: streakDays })}
                  </Text>
                </View>
              )}
            </View>
          </Card>

          <View className="gap-2">
            <Button
              label={t("logging.logAnother", { defaultValue: "Ek aur reading log karein" })}
              onPress={resetForNext}
            />
            <Button
              label={t("common.dashboard")}
              variant="ghost"
              onPress={() => router.replace("/(tabs)/dashboard")}
            />
          </View>
        </View>

        {/* Undo only when we have a server id — offline rows live in the
            local queue and the dashboard can edit them once synced. */}
        {!savedOffline && (
          <UndoToast
            visible={undoVisible}
            message={t("logging.readingSaved")}
            onUndo={() => {
              setUndoVisible(false);
              const id = lastReadingId;
              if (id) {
                void api
                  .delete(`/readings/glucose/${id}`)
                  .then(() => track("undo_used", { readingId: id }))
                  .catch(() => undefined);
              }
              setLastReadingId(null);
              setStage("input");
            }}
            onHide={() => setUndoVisible(false)}
          />
        )}
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

      {saveError !== null && <Text className="text-body text-warning">{saveError}</Text>}
    </SafeAreaView>
  );
}
