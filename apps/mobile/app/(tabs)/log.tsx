// Phase 2 — Unified log screen. Three modes (sugar | BP | meal) share
// one header + profile-aware confirmation pattern. Each mode owns its
// own input/confirm sub-flow so the glucose path stays 1:1 with Phase 1
// and the new surfaces don't accidentally inherit voice-parsing wiring
// they don't need.

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { View, Text, ScrollView, Pressable, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { bpCriticalDirection, isCriticalGlucose } from "@swasth/shared-types";
import type { GlucoseReadingType, MealCategory, MealType } from "@swasth/shared-types";
import type { NumericVoiceParseResult, VoiceParseResult } from "@swasth/domain-logic";
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
import { useCriticalAlertStore, type CriticalAlertRequest } from "@/stores/critical-alert.store";
import {
  cardiacAlertRequest,
  respiratoryAlertRequest,
  serverAlertRequest,
} from "@/services/critical-alert-requests";
import { UndoToast } from "@/components/shared/UndoToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { saveGlucoseReading } from "@/services/readings";
import { saveBPReading } from "@/services/bp";
import { refreshPriorityContact } from "@/services/priority-contact";
import { saveCardiacLog } from "@/services/cardiac";
import { saveRespiratoryLog } from "@/services/respiratory";
import { saveMealLog } from "@/services/meals";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useFeatureEnabled, useFeatureFlags } from "@/stores/feature-flags.store";
import { hapticSave } from "@/utils/haptics";
import { track } from "@/services/analytics";

type LogMode = "glucose" | "bp" | "meal" | "cardiac" | "respiratory";
type Stage = "input" | "confirm" | "saved";
type InputMethod = "voice" | "numpad";

const MODE_ICONS: Readonly<Record<LogMode, IconName>> = {
  glucose: "water-outline",
  bp: "heart-outline",
  meal: "restaurant-outline",
  cardiac: "pulse-outline",
  respiratory: "fitness-outline",
};

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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [mode, setMode] = useState<LogMode>("glucose");
  const [stage, setStage] = useState<Stage>("input");
  // Per-mode default: glucose starts on voice (Phase 1 behaviour). Cardiac
  // and respiratory start on the tap form so the user lands on the
  // familiar HR / peak-flow numpad and chips, with an explicit "Use
  // voice" toggle if they want voice for the headline numeric.
  const defaultInputMethodFor = (m: LogMode): InputMethod => (m === "glucose" ? "voice" : "numpad");
  const [inputMethod, setInputMethod] = useState<InputMethod>(defaultInputMethodFor("glucose"));

  // Glucose
  const [parsedGlucose, setParsedGlucose] = useState<ParsedGlucose | null>(null);
  const [lastReadingId, setLastReadingId] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState(0);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  // The app-wide fullscreen alert (audit P3); the root layout renders it.
  const raiseCriticalAlert = useCriticalAlertStore((s) => s.raise);
  const raiseGlucoseAlert = (value: number, direction: "low" | "high"): void => {
    raiseCriticalAlert({
      audience: "patient",
      userId,
      category: "glucose",
      direction,
      valueLabel: `${value} mg/dL`,
    });
    track("critical_bypass_triggered", { value });
  };

  // Warm the profile's critical-alert call target while online, so the
  // alert can offer it offline (audit P2).
  useEffect(() => {
    if (userId) void refreshPriorityContact(userId);
  }, [userId]);

  // BP
  const [parsedBP, setParsedBP] = useState<ParsedBP | null>(null);
  const [bpClientUuid, setBPClientUuid] = useState<string | null>(null);

  // Cardiac + Respiratory (Phase 4 Feature E, flag-gated below)
  const cardiacEnabled = useFeatureEnabled("cardiac_logging");
  const respiratoryEnabled = useFeatureEnabled("respiratory_logging");

  // Re-check feature flags each time the log tab mounts so admin
  // changes made after app startup are picked up within the TTL window.
  const refreshFlags = useFeatureFlags((s) => s.refresh);
  useEffect(() => {
    void refreshFlags();
  }, [refreshFlags]);

  const [parsedCardiac, setParsedCardiac] = useState<ParsedCardiacInput | null>(null);
  const [parsedRespiratory, setParsedRespiratory] = useState<ParsedRespiratoryInput | null>(null);
  // Voice pre-fill: parsed HR / peak flow from the cardiac / respiratory
  // voice parsers. Seeds the tap form so the user only has to fill the
  // remaining fields (rhythm, chest pain, exercise / inhaler, severity).
  const [voiceInitialHr, setVoiceInitialHr] = useState<number | undefined>(undefined);
  const [voiceInitialPeakFlow, setVoiceInitialPeakFlow] = useState<number | undefined>(undefined);

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

  const resetForNext = useCallback(
    (nextMode?: LogMode): void => {
      setStage("input");
      setInputMethod(defaultInputMethodFor(nextMode ?? mode));
      setParsedGlucose(null);
      setParsedBP(null);
      setParsedCardiac(null);
      setParsedRespiratory(null);
      setVoiceInitialHr(undefined);
      setVoiceInitialPeakFlow(undefined);
      setLastReadingId(null);
      setStreakDays(0);
      setFeedbackMsg(null);
      setSavedSummary(null);
      setUndoVisible(false);
      setSavedOffline(false);
      setSaveError(null);
    },
    [mode],
  );

  const switchMode = (next: LogMode): void => {
    if (next === mode) return;
    setMode(next);
    resetForNext(next);
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
          raiseGlucoseAlert(parsedGlucose.value, result.critical.direction);
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
          raiseGlucoseAlert(parsedGlucose.value, parsedGlucose.value < 65 ? "low" : "high");
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
        raiseGlucoseAlert(parsedGlucose.value, parsedGlucose.value < 65 ? "low" : "high");
      }
      setSaveError(t("logging.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── BP ─────────────────────────────────────────────────────
  const handleBPSubmit = (params: ParsedBP): void => {
    setParsedBP(params);
    // One id per entered reading: every retry of it is an idempotent replay.
    setBPClientUuid(uuidv4());
    setStage("confirm");
  };

  const saveBP = async (): Promise<void> => {
    if (!parsedBP || !userId || !bpClientUuid) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    // Critical BP (CLAUDE.md thresholds, shared with the server) raises the
    // fullscreen alert right away — before the network call, which can take
    // up to its 10s timeout on a bad connection. Push/SMS is the server's job.
    const bpDirection = bpCriticalDirection(parsedBP.systolic, parsedBP.diastolic);
    if (bpDirection) {
      raiseCriticalAlert({
        audience: "patient",
        userId,
        category: "bp",
        direction: bpDirection,
        valueLabel: `${parsedBP.systolic}/${parsedBP.diastolic} mmHg`,
      });
      track("critical_bypass_triggered", { category: "bp", value: parsedBP.systolic });
    }
    try {
      const result = await saveBPReading({
        userId,
        clientUuid: bpClientUuid,
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
      if (result.kind === "network_failed") {
        // BP has no local queue: say so, and keep the same reading on screen
        // so "Save" retries it (same id → no duplicate).
        setSaveError(
          result.retrying ? t("bp.saveFailedCriticalRetrying") : t("bp.saveFailedNetwork"),
        );
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

  // Voice path seeds HR only; rhythm / chest-pain / exercise stay in
  // the tap form. On reject the VoiceInput component tracks its own
  // fail count and calls onFail after the threshold — we just drop the
  // user onto the numpad form unchanged.
  const handleCardiacVoice = (result: NumericVoiceParseResult): void => {
    if (result.kind !== "ok") return;
    setVoiceInitialHr(result.value);
    setInputMethod("numpad");
  };

  const saveCardiac = async (): Promise<void> => {
    if (!parsedCardiac || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    // Critical (CLAUDE.md thresholds, shared classifier) → the fullscreen
    // alert right away, synced or offline (audit P3). Push/SMS is the server's.
    const hrLabel = `${parsedCardiac.heartRate} ${t("cardiac.bpm")}`;
    const raiseCardiacAlert = (req: CriticalAlertRequest): void => {
      raiseCriticalAlert(req);
      track("critical_bypass_triggered", { value: parsedCardiac.heartRate, surface: "cardiac" });
    };
    const cardiacLocal = cardiacAlertRequest(
      {
        heartRateBpm: parsedCardiac.heartRate,
        rhythmStatus: parsedCardiac.rhythmStatus,
        chestPain: parsedCardiac.chestPain,
        painSeverity: parsedCardiac.painSeverity ?? null,
        exerciseTolerance: parsedCardiac.exerciseTolerance,
      },
      userId,
      hrLabel,
    );
    if (cardiacLocal) raiseCardiacAlert(cardiacLocal);
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
        if (result.critical.isCritical && !cardiacLocal) {
          raiseCardiacAlert(
            serverAlertRequest("cardiac", result.critical.primaryReason, userId, hrLabel),
          );
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

  // Voice path seeds peak flow only; symptom severity + inhaler stay
  // in the tap form.
  const handleRespiratoryVoice = (result: NumericVoiceParseResult): void => {
    if (result.kind !== "ok") return;
    setVoiceInitialPeakFlow(result.value);
    setInputMethod("numpad");
  };

  const saveRespiratory = async (): Promise<void> => {
    if (!parsedRespiratory || !userId) return;
    hapticSave();
    setSaveError(null);
    setSaving(true);
    // Same as cardiac.
    const pfLabel =
      parsedRespiratory.peakFlow !== undefined
        ? `${parsedRespiratory.peakFlow} ${t("respiratory.lMin")}`
        : undefined;
    const raiseRespiratoryAlert = (req: CriticalAlertRequest): void => {
      raiseCriticalAlert(req);
      track("critical_bypass_triggered", {
        value: parsedRespiratory.peakFlow ?? 0,
        surface: "respiratory",
      });
    };
    const respiratoryLocal = respiratoryAlertRequest(parsedRespiratory, userId, pfLabel);
    if (respiratoryLocal) raiseRespiratoryAlert(respiratoryLocal);
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
        if (result.critical.isCritical && !respiratoryLocal) {
          raiseRespiratoryAlert(
            serverAlertRequest("respiratory", result.critical.primaryReason, userId, pfLabel),
          );
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
              onPress={() => resetForNext()}
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
      </SafeAreaView>
    );
  }

  // ── Input stage ───────────────────────────────────────────
  // Mode chooser — uniform grid, all modes visible at once. No
  // horizontal scrolling: older users (40-60+) won't discover hidden
  // content. Each cell is equal-width with a large 56dp touch target
  // and a vertically stacked icon + label for maximum clarity.
  // 3 modes → single row; 5 modes → 3 + 2 grid (second row centered).

  const visibleModes: { key: LogMode; label: string }[] = [
    { key: "glucose", label: t("log.modeGlucose") },
    { key: "bp", label: t("log.modeBp") },
    { key: "meal", label: t("log.modeMeal") },
    ...(cardiacEnabled ? [{ key: "cardiac" as LogMode, label: t("log.modeCardiac") }] : []),
    ...(respiratoryEnabled
      ? [{ key: "respiratory" as LogMode, label: t("log.modeRespiratory") }]
      : []),
  ];

  // 3 columns, 8px gap between items, 16px horizontal padding
  const GRID_GAP = 8;
  const GRID_PAD = 16;
  const COLS = 3;

  const modeChooser = (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: GRID_PAD,
        paddingBottom: 8,
        justifyContent: visibleModes.length <= COLS ? "flex-start" : "center",
      }}
    >
      {visibleModes.map((m) => {
        const active = mode === m.key;
        return (
          <View
            key={m.key}
            style={{
              width: `${100 / COLS}%`,
              paddingHorizontal: GRID_GAP / 2,
              paddingVertical: GRID_GAP / 2,
            }}
          >
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={m.label}
              onPress={() => switchMode(m.key)}
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                paddingHorizontal: 8,
                borderRadius: 16,
                minHeight: 56,
                backgroundColor: active ? "#2563EB" : isDark ? "#1F2937" : "#F9FAFB",
                borderWidth: 1.5,
                borderColor: active ? "#1D4ED8" : isDark ? "#374151" : "#E5E7EB",
                ...(active
                  ? {
                      shadowColor: "#2563EB",
                      shadowOpacity: 0.25,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: 4,
                    }
                  : {}),
              }}
            >
              <Icon
                name={
                  active
                    ? (MODE_ICONS[m.key].replace("-outline", "") as IconName)
                    : MODE_ICONS[m.key]
                }
                size={22}
                color={active ? "#FFFFFF" : isDark ? "#9CA3AF" : "#6B7280"}
              />
              <Text
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  fontWeight: active ? "700" : "500",
                  color: active ? "#FFFFFF" : isDark ? "#D1D5DB" : "#374151",
                }}
                numberOfLines={1}
              >
                {m.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
  // ── Shared mode header ─────────────────────────────────────
  // Contextual title + subtitle below the grid, giving the user
  // clear orientation: "what am I logging right now?"
  const MODE_TITLES: Record<LogMode, { icon: IconName; titleKey: string; subtitleKey: string }> = {
    glucose: { icon: "water", titleKey: "log.glucoseTitle", subtitleKey: "log.glucoseSubtitle" },
    bp: { icon: "heart", titleKey: "bp.title", subtitleKey: "bp.subtitle" },
    meal: { icon: "restaurant", titleKey: "meals.title", subtitleKey: "meals.subtitle" },
    cardiac: { icon: "pulse", titleKey: "cardiac.title", subtitleKey: "cardiac.subtitle" },
    respiratory: {
      icon: "fitness",
      titleKey: "respiratory.title",
      subtitleKey: "respiratory.subtitle",
    },
  };

  const modeHeader = (
    <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: isDark ? "#1E3A5F" : "#EFF6FF",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
          }}
        >
          <Icon name={MODE_TITLES[mode].icon} size={20} color="#2563EB" />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: isDark ? "#F9FAFB" : "#111827",
            }}
          >
            {t(MODE_TITLES[mode].titleKey, { defaultValue: "" })}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: isDark ? "#9CA3AF" : "#6B7280",
              marginTop: 2,
            }}
          >
            {t(MODE_TITLES[mode].subtitleKey, { defaultValue: "" })}
          </Text>
          <CheckScheduleChip />
        </View>
      </View>
    </View>
  );

  // ── Input method toggle (voice ↔ numpad) ──────────────────
  // Compact pill with icon — more discoverable than a plain ghost button
  const inputToggle = (
    <View style={{ alignItems: "center", paddingTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setInputMethod((m) => (m === "voice" ? "numpad" : "voice"))}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: isDark ? "#1F2937" : "#F3F4F6",
        }}
      >
        <Icon
          name={inputMethod === "voice" ? "keypad-outline" : "mic-outline"}
          size={18}
          color={isDark ? "#9CA3AF" : "#6B7280"}
        />
        <Text
          style={{
            marginLeft: 6,
            fontSize: 14,
            fontWeight: "500",
            color: isDark ? "#D1D5DB" : "#4B5563",
          }}
        >
          {inputMethod === "voice" ? t("logging.useNumpad") : t("logging.useVoice")}
        </Text>
      </Pressable>
    </View>
  );

  // Glucose mode keeps the Phase 1 layout exactly — VoiceInput / numpad
  // rendered OUTSIDE of any ScrollView. Wrapping the mic Pressable in a
  // ScrollView on Android intercepts its tap events and the voice
  // capture never starts, which is the regression hit during the
  // Phase 2 refactor.
  if (mode === "glucose") {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
        <View className="flex-row items-center justify-end px-4 py-3">
          <ActiveProfileBadge />
        </View>
        {modeChooser}
        {modeHeader}
        {rateLimited ? (
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
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
            <View style={{ alignItems: "center" }}>
              {inputMethod === "voice" ? (
                <VoiceInput
                  mode="glucose"
                  onParsed={handleVoice}
                  onFail={() => setInputMethod("numpad")}
                />
              ) : (
                <NumpadInput onSubmit={handleNumpad} />
              )}
            </View>
            {inputToggle}
            {saveError !== null && (
              <View
                style={{
                  marginTop: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: isDark ? "#7F1D1D" : "#FEF2F2",
                }}
              >
                <Text
                  style={{
                    color: isDark ? "#FCA5A5" : "#DC2626",
                    fontSize: 14,
                    textAlign: "center",
                  }}
                >
                  {saveError}
                </Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    );
  }

  // Cardiac / respiratory voice mode renders OUTSIDE the ScrollView for
  // the same Android tap-intercept reason called out in the glucose
  // branch above. On parse, we switch back to "numpad" and the tap
  // form below renders with the voice-captured headline number seeded.
  if ((mode === "cardiac" || mode === "respiratory") && inputMethod === "voice") {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
        <View className="flex-row items-center justify-end px-4 py-3">
          <ActiveProfileBadge />
        </View>
        {modeChooser}
        {modeHeader}
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
          <View style={{ alignItems: "center" }}>
            {mode === "cardiac" ? (
              <VoiceInput
                mode="cardiac"
                onParsed={handleCardiacVoice}
                onFail={() => setInputMethod("numpad")}
              />
            ) : (
              <VoiceInput
                mode="respiratory"
                onParsed={handleRespiratoryVoice}
                onFail={() => setInputMethod("numpad")}
              />
            )}
          </View>
          {inputToggle}
          {saveError !== null && (
            <View
              style={{
                marginTop: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: isDark ? "#7F1D1D" : "#FEF2F2",
              }}
            >
              <Text
                style={{ color: isDark ? "#FCA5A5" : "#DC2626", fontSize: 14, textAlign: "center" }}
              >
                {saveError}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // BP / Meal / cardiac-tap / respiratory-tap modes use ScrollView
  // because their input surfaces (numpad + 3 field chips + range hint,
  // or meal type + 3 large category cards) are taller than the screen
  // on small phones.
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
      <View className="flex-row items-center justify-end px-4 py-3">
        <ActiveProfileBadge />
      </View>
      {modeChooser}
      {modeHeader}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {mode === "bp" ? (
          <BPInput onSubmit={handleBPSubmit} />
        ) : mode === "cardiac" ? (
          <CardiacInput
            onSubmit={handleCardiacSubmit}
            {...(voiceInitialHr !== undefined ? { initialHeartRate: voiceInitialHr } : {})}
          />
        ) : mode === "respiratory" ? (
          <RespiratoryInput
            onSubmit={handleRespiratorySubmit}
            {...(voiceInitialPeakFlow !== undefined
              ? { initialPeakFlow: voiceInitialPeakFlow }
              : {})}
          />
        ) : (
          <MealQuickLog onSave={(p) => void saveMeal(p)} saving={saving} />
        )}

        {(mode === "cardiac" || mode === "respiratory") && inputToggle}

        {saveError !== null && (
          <View
            style={{
              marginTop: 12,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: isDark ? "#7F1D1D" : "#FEF2F2",
            }}
          >
            <Text
              style={{ color: isDark ? "#FCA5A5" : "#DC2626", fontSize: 14, textAlign: "center" }}
            >
              {saveError}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
