// Phase 4 Feature E — Cardiac confirmation screen. Mirrors the
// BPConfirmationScreen pattern: profile line, the entered values, a
// critical / warn banner derived from local classification (so the
// patient sees the severity BEFORE the server round-trip), and a
// single primary CTA.

import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { classifyCardiacReading } from "@swasth/domain-logic";
import type { ExerciseTolerance, RhythmStatus } from "@swasth/shared-types";

import { SaveErrorNotice } from "@/components/shared/SaveErrorNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useProfileStore, isRecentSwitch } from "@/stores/profile.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";

interface CardiacConfirmationProps {
  heartRate: number;
  rhythmStatus: RhythmStatus;
  chestPain: boolean;
  painSeverity?: number;
  exerciseTolerance: ExerciseTolerance;
  onConfirm: () => void;
  onEdit: () => void;
  /** Shown above the buttons when the last save didn't go through. */
  errorMessage?: string | null;
  /** A save is in flight: the confirm button is disabled (no double save). */
  saving?: boolean;
}

export const CardiacConfirmationScreen = ({
  heartRate,
  rhythmStatus,
  chestPain,
  painSeverity,
  exerciseTolerance,
  onConfirm,
  onEdit,
  errorMessage = null,
  saving = false,
}: CardiacConfirmationProps): JSX.Element => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const recentSwitch = useProfileStore(isRecentSwitch);

  // Pre-compute the local classification so the screen can warn the
  // user BEFORE save. The server runs the same pure function with the
  // same inputs, so this is a faithful preview — not a guess.
  const classification = classifyCardiacReading({
    heartRateBpm: heartRate,
    rhythmStatus,
    chestPain,
    painSeverity: painSeverity ?? null,
    exerciseTolerance,
  });

  const isCritical = classification.severity === "critical_bypass";
  const isWarn = classification.severity === "warn";

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-900">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <View className="flex-row items-center gap-2">
              <Icon name="person" size={16} color="#374151" />
              <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                {profile?.name && profile.name.trim().length > 0
                  ? t("logging.profileLine", { profile: profile.name })
                  : t("logging.profileLine", { profile: "" })}
              </Text>
            </View>
            {recentSwitch && profile?.name !== undefined && (
              <Text className="mt-1 text-body text-warning">
                {t("logging.recentSwitchConfirm", { profile: profile.name })}
              </Text>
            )}
          </Card>

          <Card>
            <Text className="text-body text-neutral dark:text-gray-400">
              {t("cardiac.heartRate")}
            </Text>
            <View className="mt-1 flex-row items-baseline gap-2">
              <Text
                className={`text-5xl font-bold tracking-tight ${
                  isCritical
                    ? "text-critical"
                    : isWarn
                      ? "text-warning"
                      : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {heartRate}
              </Text>
              <Text className="text-important text-neutral dark:text-gray-400">
                {t("cardiac.bpm")}
              </Text>
            </View>

            <View className="mt-3 gap-1">
              <DetailLine
                label={t("cardiac.rhythm.label")}
                value={t(`cardiac.rhythm.${rhythmStatus}`)}
              />
              <DetailLine
                label={t("cardiac.chestPain.label")}
                value={
                  chestPain
                    ? painSeverity !== undefined
                      ? `${t("cardiac.chestPain.yes")} • ${painSeverity}/10`
                      : t("cardiac.chestPain.yes")
                    : t("cardiac.chestPain.no")
                }
                tone={chestPain ? "warn" : "default"}
              />
              <DetailLine
                label={t("cardiac.exerciseTolerance.label")}
                value={t(`cardiac.exerciseTolerance.${exerciseTolerance}`)}
              />
            </View>

            {isCritical && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/40">
                <Icon name="warning" size={20} color="#DC2626" />
                <Text className="flex-1 text-important text-red-900 dark:text-red-200">
                  {t(`cardiac.classification.${classification.reason}`, {
                    defaultValue: t("cardiac.classification.critical"),
                  })}
                </Text>
              </View>
            )}
            {isWarn && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
                <Icon name="alert-circle" size={20} color="#D97706" />
                <Text className="flex-1 text-important text-amber-900 dark:text-amber-200">
                  {t(`cardiac.classification.${classification.reason}`, {
                    defaultValue: t("cardiac.classification.warn"),
                  })}
                </Text>
              </View>
            )}
          </Card>

          {errorMessage ? <SaveErrorNotice message={errorMessage} /> : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button label={t("common.edit")} variant="ghost" onPress={onEdit} />
            </View>
            <View className="flex-[2]">
              <Button
                label={saving ? t("common.loading") : t("common.confirm")}
                variant={isCritical ? "secondary" : isWarn ? "secondary" : "primary"}
                disabled={saving}
                onPress={onConfirm}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

interface DetailLineProps {
  label: string;
  value: string;
  tone?: "default" | "warn";
}

const DetailLine = ({ label, value, tone = "default" }: DetailLineProps): JSX.Element => (
  <View className="flex-row items-baseline justify-between">
    <Text className="text-body text-neutral dark:text-gray-400">{label}</Text>
    <Text
      className={`text-body font-semibold ${
        tone === "warn" ? "text-amber-900 dark:text-amber-200" : "text-gray-900 dark:text-gray-100"
      }`}
    >
      {value}
    </Text>
  </View>
);
