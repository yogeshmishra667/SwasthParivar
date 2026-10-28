// Phase 2 — BP confirmation screen. Mirrors the glucose confirmation
// pattern: shows the active profile, the entered pair, and a single
// CTA. No festive toggle (not a meal-tied measurement), no fasting/
// post-meal toggle (not applicable).

import type { ReactNode } from "react";
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { SaveErrorNotice } from "@/components/shared/SaveErrorNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useProfileStore, isRecentSwitch } from "@/stores/profile.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";

interface BPConfirmationProps {
  systolic: number;
  diastolic: number;
  pulse?: number;
  onConfirm: () => void;
  onEdit: () => void;
  /** Shown above the buttons when the last save didn't go through. */
  errorMessage?: string | null;
  /** Under the message, e.g. the call button when a critical entry failed. */
  errorAction?: ReactNode;
  /**
   * A save is in flight: confirm and edit are disabled, so neither a double
   * save nor an edit can be overtaken by the first save's result.
   */
  saving?: boolean;
}

const HIGH_SYS = 140;
const HIGH_DIA = 90;

export const BPConfirmationScreen = ({
  systolic,
  diastolic,
  pulse,
  onConfirm,
  onEdit,
  errorMessage = null,
  errorAction = null,
  saving = false,
}: BPConfirmationProps): JSX.Element => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const recentSwitch = useProfileStore(isRecentSwitch);
  const elevated = systolic >= HIGH_SYS || diastolic >= HIGH_DIA;

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
            <Text className="text-body text-neutral dark:text-gray-400">{t("bp.title")}</Text>
            <View className="mt-1 flex-row items-baseline gap-2">
              <Text
                className={`text-5xl font-bold tracking-tight ${
                  elevated ? "text-warning" : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {systolic}
                <Text className="text-3xl text-neutral dark:text-gray-400">/</Text>
                {diastolic}
              </Text>
              <Text className="text-important text-neutral dark:text-gray-400">mmHg</Text>
            </View>
            {pulse !== undefined && (
              <Text className="mt-1 text-body text-neutral dark:text-gray-400">
                {t("bp.pulse")}:{" "}
                <Text className="font-semibold text-gray-900 dark:text-gray-100">{pulse}</Text>
              </Text>
            )}
            {elevated && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
                <Icon name="warning" size={20} color="#D97706" />
                <Text className="flex-1 text-important text-amber-900 dark:text-amber-200">
                  {t("bp.highBanner")}
                </Text>
              </View>
            )}
          </Card>

          {errorMessage ? <SaveErrorNotice message={errorMessage} /> : null}
          {errorMessage && errorAction ? <View className="mt-3">{errorAction}</View> : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button label={t("common.edit")} variant="ghost" disabled={saving} onPress={onEdit} />
            </View>
            <View className="flex-[2]">
              <Button
                label={saving ? t("common.loading") : t("common.confirm")}
                variant={elevated ? "secondary" : "primary"}
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
