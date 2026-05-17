// Phase 2 — BP confirmation screen. Mirrors the glucose confirmation
// pattern: shows the active profile, the entered pair, and a single
// CTA. No festive toggle (not a meal-tied measurement), no fasting/
// post-meal toggle (not applicable).

import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

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
}

const HIGH_SYS = 140;
const HIGH_DIA = 90;

export const BPConfirmationScreen = ({
  systolic,
  diastolic,
  pulse,
  onConfirm,
  onEdit,
}: BPConfirmationProps): JSX.Element => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const recentSwitch = useProfileStore(isRecentSwitch);
  const elevated = systolic >= HIGH_SYS || diastolic >= HIGH_DIA;

  return (
    <SafeAreaView className="flex-1 bg-white">
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
              <Text className="text-important font-semibold">
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
            <Text className="text-body text-neutral">{t("bp.title")}</Text>
            <View className="mt-1 flex-row items-baseline gap-2">
              <Text
                className={`text-5xl font-bold tracking-tight ${
                  elevated ? "text-warning" : "text-gray-900"
                }`}
              >
                {systolic}
                <Text className="text-3xl text-neutral">/</Text>
                {diastolic}
              </Text>
              <Text className="text-important text-neutral">mmHg</Text>
            </View>
            {pulse !== undefined && (
              <Text className="mt-1 text-body text-neutral">
                {t("bp.pulse")}: <Text className="font-semibold text-gray-900">{pulse}</Text>
              </Text>
            )}
            {elevated && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <Icon name="warning" size={20} color="#D97706" />
                <Text className="flex-1 text-important text-amber-900">{t("bp.highBanner")}</Text>
              </View>
            )}
          </Card>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button label={t("common.edit")} variant="ghost" onPress={onEdit} />
            </View>
            <View className="flex-[2]">
              <Button
                label={t("common.confirm")}
                variant={elevated ? "secondary" : "primary"}
                onPress={onConfirm}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
