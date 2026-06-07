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
import { CheckScheduleChip } from "@/components/logging/CheckScheduleChip";
import { NextCheckReminderCard } from "@/components/logging/NextCheckReminderCard";
import { VoiceInput } from "@/components/logging/VoiceInput";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { BPInput } from "@/components/logging/BPInput";
import { BPConfirmationScreen } from "@/components/logging/BPConfirmationScreen";
import { CardiacInput, type ParsedCardiacInput } from "@/components/logging/CardiacInput";
import { CardiacConfirmationScreen } from "@/components/logging/CardiacConfirmationScreen";
import {
  RespiratoryInput,
  type ParsedRespiratoryInput,
} from "@/components/logging/RespiratoryInput";
import { RespiratoryConfirmationScreen } from "@/components/logging/RespiratoryConfirmationScreen";
import { MealQuickLog } from "@/components/logging/MealQuickLog";
import { CriticalAlert } from "@/components/logging/CriticalAlert";
import { UndoToast } from "@/components/shared/UndoToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { saveGlucoseReading } from "@/services/readings";
import { saveBPReading } from "@/services/bp";
import { saveCardiacLog } from "@/services/cardiac";
import { saveRespiratoryLog } from "@/services/respiratory";
import { saveMealLog } from "@/services/meals";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useFeatureEnabled } from "@/stores/feature-flags.store";
import { hapticSave } from "@/utils/haptics";
import { track } from "@/services/analytics";

type LogMode = "glucose" | "bp" | "meal" | "cardiac" | "respiratory";
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

  // Cardiac + Respiratory (Phase 4 Feature E, flag-gated below)
  const cardiacEnabled = useFeatureEnabled("cardiac_logging");
  const respiratoryEnabled = useFeatureEnabled("respiratory_logging");
  const [parsedCardiac, setParsedCardiac] = useState<ParsedCardiacInput | null>(null);
  const [parsedRespiratory, setParsedRespiratory] = useState<ParsedRespiratoryInput | null>(null);

  // Shared post-save state
  const [undoVisible, setUndoVisible] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Glucose daily-cap state. Persists for the session so a switch
  // away to BP/Meal and back still shows the cap card — the server
  // counter doesn't reset until the next 3 AM IST boundary.
  const [rateLimited, setRateLimited] = useState(false);
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
    setParsedCardiac(null);
    setParsedRespiratory(null);
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

      // result.kind === "rejected" — branch on code so the user gets
      // the right copy. Rate-limit gets its own full-screen card; other
      // rejections fall through to the generic inline warning.
      if (result.kind === "rejected" && result.code === "RATE_LIMITED") {
        setRateLimited(true);
        track("rate_limit_hit", { surface: "readings", value: parsedGlucose.value });
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

  // ── Cardiac (Phase 4 Feature E) ────────────────────────────
  const handleCardiacSubmit = (params: ParsedCardiacInput): void => {
    setParsedCardiac(params);
    setStage("confirm");
  };

  const saveCardiac = async (): Promise<void> => {
    if (!parsedCardiac || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    try {
      const result = await saveCardiacLog({
        userId,
        heartRate: parsedCardiac.heartRate,
        rhythmStatus: parsedCardiac.rhythmStatus,
        chestPain: parsedCardiac.chestPain,
        ...(parsedCardiac.painSeverity !== undefined
          ? { painSeverity: parsedCardiac.painSeverity }
          : {}),
        exerciseTolerance: parsedCardiac.exerciseTolerance,
        source: "manual",
        measuredAtIso: new Date().toISOString(),
      });

      if (result.kind === "synced") {
        setSavedOffline(false);
        if (result.critical.isCritical) {
          // Heart-rate-driven bypass routes through the same fullscreen
          // alert primitive as glucose; the contact targeting is
          // server-side (CRITICAL_ALERT job already enqueued).
          track("critical_bypass_triggered", {
            value: parsedCardiac.heartRate,
            surface: "cardiac",
          });
        }
        setSavedSummary({
          headline: `${result.heartRate} ${t("cardiac.bpm")}`,
          detail: t("cardiac.saved"),
        });
        setStage("saved");
        return;
      }
      if (result.kind === "queued") {
        setSavedOffline(true);
        setSavedSummary({
          headline: `${parsedCardiac.heartRate} ${t("cardiac.bpm")}`,
          detail: t("cardiac.savedOffline"),
        });
        setStage("saved");
        return;
      }
      if (result.code === "CARDIAC_DISABLED") {
        setSaveError(t("cardiac.disabled"));
        return;
      }
      setSaveError(t("cardiac.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Respiratory (Phase 4 Feature E) ────────────────────────
  const handleRespiratorySubmit = (params: ParsedRespiratoryInput): void => {
    setParsedRespiratory(params);
    setStage("confirm");
  };

  const saveRespiratory = async (): Promise<void> => {
    if (!parsedRespiratory || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    try {
      const result = await saveRespiratoryLog({
        userId,
        ...(parsedRespiratory.peakFlow !== undefined
          ? { peakFlow: parsedRespiratory.peakFlow }
          : {}),
        inhalerUsed: parsedRespiratory.inhalerUsed,
        ...(parsedRespiratory.puffs !== undefined ? { puffs: parsedRespiratory.puffs } : {}),
        symptomSeverity: parsedRespiratory.symptomSeverity,
        source: "manual",
        measuredAtIso: new Date().toISOString(),
      });

      const headline =
        parsedRespiratory.peakFlow !== undefined
          ? `${parsedRespiratory.peakFlow} ${t("respiratory.lMin")}`
          : t(`respiratory.symptom.${parsedRespiratory.symptomSeverity}`);

      if (result.kind === "synced") {
        setSavedOffline(false);
        if (result.critical.isCritical) {
          track("critical_bypass_triggered", {
            value: parsedRespiratory.peakFlow ?? 0,
            surface: "respiratory",
          });
        }
        setSavedSummary({ headline, detail: t("respiratory.saved") });
        setStage("saved");
        return;
      }
      if (result.kind === "queued") {
        setSavedOffline(true);
        setSavedSummary({ headline, detail: t("respiratory.savedOffline") });
        setStage("saved");
        return;
      }
      if (result.code === "RESPIRATORY_DISABLED") {
        setSaveError(t("respiratory.disabled"));
        return;
      }
      setSaveError(t("respiratory.saveFailed"));
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

  if (stage === "confirm" && mode === "cardiac" && parsedCardiac) {
    return (
      <CardiacConfirmationScreen
        heartRate={parsedCardiac.heartRate}
        rhythmStatus={parsedCardiac.rhythmStatus}
        chestPain={parsedCardiac.chestPain}
        {...(parsedCardiac.painSeverity !== undefined
          ? { painSeverity: parsedCardiac.painSeverity }
          : {})}
        exerciseTolerance={parsedCardiac.exerciseTolerance}
        onConfirm={() => void saveCardiac()}
        onEdit={() => {
          setSaveError(null);
          setStage("input");
        }}
      />
    );
  }

  if (stage === "confirm" && mode === "respiratory" && parsedRespiratory) {
    return (
      <RespiratoryConfirmationScreen
        {...(parsedRespiratory.peakFlow !== undefined
          ? { peakFlow: parsedRespiratory.peakFlow }
          : {})}
        inhalerUsed={parsedRespiratory.inhalerUsed}
        {...(parsedRespiratory.puffs !== undefined ? { puffs: parsedRespiratory.puffs } : {})}
        symptomSeverity={parsedRespiratory.symptomSeverity}
        onConfirm={() => void saveRespiratory()}
        onEdit={() => {
          setSaveError(null);
          setStage("input");
        }}
      />
    );
  }

  if (stage === "saved") {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
            {t("logging.saved")}
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
                  <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
                    {savedSummary.headline}
                  </Text>
                  {savedSummary.detail !== undefined && (
                    <Text className="text-important text-center text-neutral dark:text-gray-400">
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
                <Text className="text-important text-center text-gray-900 dark:text-gray-100">
                  {feedbackMsg}
                </Text>
              )}
            </View>
          </Card>

          {/* Habit-loop reinforcement: tell the user when the next
              check-frequency reminder will fire. Closes the loop on
              the cadence they chose in Settings. Hides itself when
              notifications are off. */}
          <NextCheckReminderCard />

          <View className="gap-2">
            <Button
              label={
                mode === "glucose"
                  ? t("logging.logAnother")
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
  // Mode chooser row — shared header. Cardiac + respiratory only
  // appear when their per-user rollout flag returns true; a patient
  // outside the cohort sees the original 3-button layout, byte-
  // identical to Phase 2.
  const modeChooser = (
    <View className="flex-row flex-wrap gap-2 px-4 pb-3">
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
      {cardiacEnabled && (
        <View className="flex-1">
          <Button
            label={t("log.modeCardiac")}
            variant={mode === "cardiac" ? "primary" : "ghost"}
            onPress={() => switchMode("cardiac")}
          />
        </View>
      )}
      {respiratoryEnabled && (
        <View className="flex-1">
          <Button
            label={t("log.modeRespiratory")}
            variant={mode === "respiratory" ? "primary" : "ghost"}
            onPress={() => switchMode("respiratory")}
          />
        </View>
      )}
    </View>
  );

  // Glucose mode keeps the Phase 1 layout exactly — VoiceInput / numpad
  // rendered OUTSIDE of any ScrollView. Wrapping the mic Pressable in a
  // ScrollView on Android intercepts its tap events and the voice
  // capture never starts, which is the regression hit during the
  // Phase 2 refactor.
  if (mode === "glucose") {
    return (
      <SafeAreaView className="flex-1 gap-6 bg-white dark:bg-gray-900">
        <View className="flex-row items-center justify-end px-4 py-3">
          <ActiveProfileBadge />
        </View>
        {modeChooser}
        <CheckScheduleChip />
        {rateLimited ? (
          // Daily-cap reached. Replace the input surface entirely so the
          // user can't keep tapping the mic / numpad to no effect, but
          // leave the mode chooser visible — BP and meals are still
          // available and the cap only applies to glucose.
          <View className="flex-1 justify-center gap-4 px-6">
            <Card className="border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <View className="items-center gap-3 py-4">
                <Icon name="time-outline" size={48} color="#D97706" />
                <Text
                  className="text-hero font-bold text-center text-gray-900 dark:text-gray-100"
                  accessibilityRole="header"
                >
                  {t("logging.rateLimited.title")}
                </Text>
                <Text className="text-important text-center text-gray-700 dark:text-gray-300">
                  {t("logging.rateLimited.body")}
                </Text>
              </View>
            </Card>
            <Button
              label={t("logging.rateLimited.cta")}
              onPress={() => router.replace("/(tabs)/dashboard")}
            />
          </View>
        ) : (
          <View className="flex-1 gap-6 px-6">
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
            {saveError !== null && <Text className="text-body text-warning">{saveError}</Text>}
          </View>
        )}
      </SafeAreaView>
    );
  }

  // BP / Meal modes use ScrollView because their input surfaces (numpad
  // + 3 field chips + range hint, or meal type + 3 large category
  // cards) are taller than the screen on small phones.
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
      <View className="flex-row items-center justify-end px-4 py-3">
        <ActiveProfileBadge />
      </View>
      {modeChooser}
      <CheckScheduleChip />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {mode === "bp" ? (
          <BPInput onSubmit={handleBPSubmit} />
        ) : mode === "cardiac" ? (
          <CardiacInput onSubmit={handleCardiacSubmit} />
        ) : mode === "respiratory" ? (
          <RespiratoryInput onSubmit={handleRespiratorySubmit} />
        ) : (
          <MealQuickLog onSave={(p) => void saveMeal(p)} saving={saving} />
        )}

        {saveError !== null && <Text className="text-body text-warning">{saveError}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
