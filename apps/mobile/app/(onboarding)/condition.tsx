import { useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";

export default function ConditionScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const select = async (condition: string): Promise<void> => {
    setSaving(true);
    try {
      await api.patch("/users/me", {
        conditions: [condition],
        onboardingStep: 2,
      });
    } catch {
      // continue even if server unreachable — offline-first
    }
    setSaving(false);
    router.push("/(onboarding)/profile");
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">{t("onboarding.selectCondition")}</Text>
      <Button
        label={t("onboarding.diabetes")}
        onPress={() => void select("diabetes")}
        disabled={saving}
      />
    </View>
  );
}
