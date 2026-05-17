// Phase 2 — Unified log screen. Three modes (sugar | BP | meal) share
// one header + profile-aware confirmation pattern. Each mode owns its
// own input/confirm sub-flow so the glucose path stays 1:1 with Phase 1
// and the new surfaces don't accidentally inherit voice-parsing wiring
// they don't need.

import { useCallback, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { isCriticalGlucose } from "@swasth/shared-types";
import type { GlucoseReadingType, MealCategory, MealType } from "@swasth/shared-types";
import type { VoiceParseResult } from "@swasth/domain-logic";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { VoiceInput } from "@/components/logging/VoiceInput";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { BPInput } from "@/components/logging/BPInput";
import { BPConfirmationScreen } from "@/components/logging/BPConfirmationScreen";
import { MealQuickLog } from "@/components/logging/MealQuickLog";
import { CriticalAlert } from "@/components/logging/CriticalAlert";
import { UndoToast } from "@/components/shared/UndoToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { saveGlucoseReading } from "@/services/readings";
import { saveBPReading } from "@/services/bp";
import { saveMealLog } from "@/services/meals";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { hapticSave } from "@/utils/haptics";
import { track } from "@/services/analytics";

type LogMode = "glucose" | "bp" | "meal";
type Stage = "input" | "confirm" | "saved";
type InputMethod = "voice" | "numpad";

interface ParsedGlucose {
  value: number;
  type: GlucoseReadingType;
  uncertain: boolean;
}

interface ParsedBP {
  systolic: number;
  diastolic: number;
  pulse?: number;
}

export default function LogScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const activeProfile = useActiveProfile();
  const userId = activeProfile?.id ?? null;

  const [mode, setMode] = useState<LogMode>("glucose");
  const [stage, setStage] = useState<Stage>("input");
  const [inputMethod, setInputMethod] = useState<InputMethod>("voice");

  // Glucose
  const [parsedGlucose, setParsedGlucose] = useState<ParsedGlucose | null>(null);
  const [lastReadingId, setLastReadingId] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState(0);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [criticalAlert, setCriticalAlert] = useState<{
    visible: boolean;
    value: number;
    direction: "low" | "high";
  }>({ visible: false, value: 0, direction: "low" });

  // BP
  const [parsedBP, setParsedBP] = useState<ParsedBP | null>(null);

  // Shared post-save state
  const [undoVisible, setUndoVisible] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<{
    headline: string;
    detail?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForNext = useCallback((): void => {
    setStage("input");
    setInputMethod("voice");
    setParsedGlucose(null);
    setParsedBP(null);
    setLastReadingId(null);
    setStreakDays(0);
    setFeedbackMsg(null);
    setSavedSummary(null);
    setUndoVisible(false);
    setSavedOffline(false);
    setSaveError(null);
  }, []);

  const switchMode = (next: LogMode): void => {
    if (next === mode) return;
    setMode(next);
    resetForNext();
  };

  // ── Glucose ───────────────────────────────────────────────
  const handleVoice = (result: VoiceParseResult): void => {
    if (result.kind !== "ok") return;
    setParsedGlucose({
      value: result.value,
      type: result.readingType,
      uncertain: result.requiresTypeConfirmation,
    });
    setStage("confirm");
  };

  const handleNumpad = (value: number): void => {
    setParsedGlucose({ value, type: "fasting", uncertain: true });
    setStage("confirm");
  };

  const saveGlucose = async (
    type: GlucoseReadingType,
    context: "normal" | "festive",
  ): Promise<void> => {
    if (!parsedGlucose || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);

    try {
      const result = await saveGlucoseReading({
        userId,
        valueMgDl: parsedGlucose.value,
        readingType: type,
        context,
        source: inputMethod === "voice" ? "voice" : "manual",
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
            value: parsedGlucose.value,
            direction: result.critical.direction,
          });
          track("critical_bypass_triggered", { value: parsedGlucose.value });
        }
        setUndoVisible(true);
        setSavedSummary({
          headline: `${parsedGlucose.value} mg/dL`,
          detail: t(`feedback.${result.feedback.tone}`, { defaultValue: t("logging.saved") }),
        });
        setStage("saved");
        return;
      }

      if (result.kind === "queued") {
        setSavedOffline(true);
        setFeedbackMsg(t("logging.savedOffline"));
        if (isCriticalGlucose(parsedGlucose.value)) {
          const dir = parsedGlucose.value < 65 ? "low" : "high";
          setCriticalAlert({ visible: true, value: parsedGlucose.value, direction: dir });
          track("critical_bypass_triggered", { value: parsedGlucose.value });
        }
        setSavedSummary({
          headline: `${parsedGlucose.value} mg/dL`,
          detail: t("logging.savedOffline"),
        });
        setStage("saved");
        return;
      }

      if (isCriticalGlucose(parsedGlucose.value)) {
        const dir = parsedGlucose.value < 65 ? "low" : "high";
        setCriticalAlert({ visible: true, value: parsedGlucose.value, direction: dir });
        track("critical_bypass_triggered", { value: parsedGlucose.value });
      }
      setSaveError(t("logging.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── BP ─────────────────────────────────────────────────────
  const handleBPSubmit = (params: ParsedBP): void => {
    setParsedBP(params);
    setStage("confirm");
  };

  const saveBP = async (): Promise<void> => {
    if (!parsedBP || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    try {
      const result = await saveBPReading({
        userId,
        systolic: parsedBP.systolic,
        diastolic: parsedBP.diastolic,
        ...(parsedBP.pulse !== undefined ? { pulse: parsedBP.pulse } : {}),
        source: "manual",
        measuredAtIso: new Date().toISOString(),
      });

      if (result.kind === "synced") {
        setSavedOffline(false);
        setSavedSummary({
          headline: `${parsedBP.systolic}/${parsedBP.diastolic} mmHg`,
          detail: t("bp.saved"),
        });
        setStage("saved");
        return;
      }
      if (result.kind === "queued") {
        setSavedOffline(true);
        setSavedSummary({
          headline: `${parsedBP.systolic}/${parsedBP.diastolic} mmHg`,
          detail: t("bp.savedOffline"),
        });
        setStage("saved");
        return;
      }
      setSaveError(t("bp.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Meal ───────────────────────────────────────────────────
  const saveMeal = async (params: {
    mealType: MealType;
    mealCategory: MealCategory;
  }): Promise<void> => {
    if (!userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    try {
      const result = await saveMealLog({
        userId,
        mealType: params.mealType,
        mealCategory: params.mealCategory,
        loggedAtIso: new Date().toISOString(),
      });

      const categoryLabel =
        params.mealCategory === "light"
          ? t("meals.light")
          : params.mealCategory === "normal"
            ? t("meals.normal")
            : t("meals.heavy");
      const detail = `${t(`meals.type.${params.mealType}`)} • ${categoryLabel}`;

      if (result.kind === "synced") {
        setSavedOffline(false);
        setSavedSummary({ headline: t("meals.saved"), detail });
        setStage("saved");
        return;
      }
      if (result.kind === "queued") {
        setSavedOffline(true);
        setSavedSummary({ headline: t("meals.saved"), detail: t("logging.savedOffline") });
        setStage("saved");
        return;
      }
      setSaveError(t("meals.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  if (stage === "confirm" && mode === "glucose" && parsedGlucose) {
    return (
      <>
        <ConfirmationScreen
          value={parsedGlucose.value}
          type={parsedGlucose.type}
          uncertainType={parsedGlucose.uncertain}
          onConfirm={(type, ctx) => void saveGlucose(type, ctx)}
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

  if (stage === "confirm" && mode === "bp" && parsedBP) {
    return (
      <BPConfirmationScreen
        systolic={parsedBP.systolic}
        diastolic={parsedBP.diastolic}
        {...(parsedBP.pulse !== undefined ? { pulse: parsedBP.pulse } : {})}
        onConfirm={() => void saveBP()}
        onEdit={() => {
          setSaveError(null);
          setStage("input");
        }}
      />
    );
  }

  if (stage === "saved") {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-hero font-bold">
            {t("logging.savedTitle", { defaultValue: t("logging.saved") })}
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
              {savedSummary && (
                <>
                  <Text className="text-hero font-bold">{savedSummary.headline}</Text>
                  {savedSummary.detail !== undefined && (
                    <Text className="text-important text-center text-neutral">
                      {savedSummary.detail}
                    </Text>
                  )}
                </>
              )}
              {streakDays > 0 && mode === "glucose" && (
                <View className="flex-row items-center gap-2">
                  <Icon name="flame" size={20} color="#F59E0B" />
                  <Text className="text-body">
                    {t("logging.streakCount", { count: streakDays })}
                  </Text>
                </View>
              )}
              {feedbackMsg !== null && mode === "glucose" && (
                <Text className="text-important text-center">{feedbackMsg}</Text>
              )}
            </View>
          </Card>

          <View className="gap-2">
            <Button
              label={
                mode === "glucose"
                  ? t("logging.logAnother", { defaultValue: "Ek aur reading log karein" })
                  : mode === "bp"
                    ? t("bp.title")
                    : t("meals.logMore")
              }
              onPress={resetForNext}
            />
            <Button
              label={t("common.dashboard")}
              variant="ghost"
              onPress={() => router.replace("/(tabs)/dashboard")}
            />
          </View>
        </View>

        {/* Glucose-only undo. BP/Meals don't expose a server-side delete from
            the saved screen yet — adding undo there is queued for Phase 3. */}
        {mode === "glucose" && !savedOffline && (
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

  // ── Input stage ───────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center justify-end px-4 py-3">
        <ActiveProfileBadge />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {/* Mode chooser — three full-width Buttons (the existing
            primary Button component is battle-tested across the app). */}
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              label={t("log.modeGlucose")}
              variant={mode === "glucose" ? "primary" : "ghost"}
              onPress={() => switchMode("glucose")}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t("log.modeBp")}
              variant={mode === "bp" ? "primary" : "ghost"}
              onPress={() => switchMode("bp")}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t("log.modeMeal")}
              variant={mode === "meal" ? "primary" : "ghost"}
              onPress={() => switchMode("meal")}
            />
          </View>
        </View>

        {mode === "glucose" ? (
          <View className="gap-6">
            {inputMethod === "voice" ? (
              <VoiceInput onParsed={handleVoice} onFail={() => setInputMethod("numpad")} />
            ) : (
              <NumpadInput onSubmit={handleNumpad} />
            )}
            <Button
              label={inputMethod === "voice" ? t("logging.useNumpad") : t("logging.useVoice")}
              variant="ghost"
              onPress={() => setInputMethod((m) => (m === "voice" ? "numpad" : "voice"))}
            />
          </View>
        ) : mode === "bp" ? (
          <BPInput onSubmit={handleBPSubmit} />
        ) : (
          <MealQuickLog onSave={(p) => void saveMeal(p)} saving={saving} />
        )}

        {saveError !== null && <Text className="text-body text-warning">{saveError}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
