// Phase 4 Feature E — Respiratory confirmation screen. Symmetric to
// CardiacConfirmationScreen: runs the pure classifier locally so the
// patient sees red-zone severity BEFORE the server round-trip.

import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { classifyRespiratoryReading } from "@swasth/domain-logic";
import type { SymptomSeverity } from "@swasth/shared-types";

import { SaveErrorNotice } from "@/components/shared/SaveErrorNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useProfileStore, isRecentSwitch } from "@/stores/profile.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";

interface RespiratoryConfirmationProps {
  peakFlow?: number;
  baselinePeakFlow?: number;
  inhalerUsed: boolean;
  puffs?: number;
  symptomSeverity: SymptomSeverity;
  onConfirm: () => void;
  onEdit: () => void;
  /** Shown above the buttons when the last save didn't go through. */
  errorMessage?: string | null;
  /** A save is in flight: the confirm button is disabled (no double save). */
  saving?: boolean;
}

export const RespiratoryConfirmationScreen = ({
  peakFlow,
  baselinePeakFlow,
  inhalerUsed,
  puffs,
  symptomSeverity,
  onConfirm,
  onEdit,
  errorMessage = null,
  saving = false,
}: RespiratoryConfirmationProps): JSX.Element => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const recentSwitch = useProfileStore(isRecentSwitch);

  const classification = classifyRespiratoryReading({
    peakFlow: peakFlow ?? null,
    baselinePeakFlow: baselinePeakFlow ?? null,
    inhalerUsed,
    symptomSeverity,
  });

  const isCritical = classification.severity === "critical_bypass";
  const isWarn = classification.severity === "warn";
  const ratioPercent =
    classification.peakFlowRatio !== null ? Math.round(classification.peakFlowRatio * 100) : null;

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
              {t("respiratory.title")}
            </Text>
            {peakFlow !== undefined ? (
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
                  {peakFlow}
                </Text>
                <Text className="text-important text-neutral dark:text-gray-400">
                  {t("respiratory.lMin")}
                </Text>
                {ratioPercent !== null && (
                  <Text className="text-body text-neutral dark:text-gray-400">
                    {t("respiratory.percentOfBaseline", { percent: ratioPercent })}
                  </Text>
                )}
              </View>
            ) : (
              // No numeric peak flow — show the dominant symptom signal so
              // the confirmation still tells the patient what they're saving.
              <Text className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {t(`respiratory.symptom.${symptomSeverity}`)}
              </Text>
            )}

            <View className="mt-3 gap-1">
              <DetailLine
                label={t("respiratory.symptom.label")}
                value={t(`respiratory.symptom.${symptomSeverity}`)}
                tone={symptomSeverity === "severe" ? "warn" : "default"}
              />
              <DetailLine
                label={t("respiratory.inhaler.label")}
                value={
                  inhalerUsed
                    ? puffs !== undefined
                      ? `${t("respiratory.inhaler.yes")} • ${puffs} ${t("respiratory.puffs.unit", { count: puffs })}`
                      : t("respiratory.inhaler.yes")
                    : t("respiratory.inhaler.no")
                }
              />
            </View>

            {isCritical && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/40">
                <Icon name="warning" size={20} color="#DC2626" />
                <Text className="flex-1 text-important text-red-900 dark:text-red-200">
                  {t(`respiratory.classification.${classification.reason}`, {
                    defaultValue: t("respiratory.classification.critical"),
                  })}
                </Text>
              </View>
            )}
            {isWarn && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
                <Icon name="alert-circle" size={20} color="#D97706" />
                <Text className="flex-1 text-important text-amber-900 dark:text-amber-200">
                  {t(`respiratory.classification.${classification.reason}`, {
                    defaultValue: t("respiratory.classification.warn"),
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
