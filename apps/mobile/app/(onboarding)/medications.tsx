import { useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export default function MedicationsOnboarding(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const completeOnboarding = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.patch("/users/me", {
        onboardingComplete: true,
        onboardingStep: 5,
      });
    } catch (e) {
      logError("onboarding/medications", e);
    }
    setSaving(false);
    router.replace("/(tabs)/dashboard");
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">{t("onboarding.addMedicines")}</Text>
      <Text className="text-important">{t("onboarding.addMedicinesLater")}</Text>
      <Button
        label={t("medications.addMedicines")}
        onPress={() => router.push("/(tabs)/medications")}
        disabled={saving}
      />
      <Button
        label={t("common.skip")}
        variant="ghost"
        onPress={() => void completeOnboarding()}
        disabled={saving}
      />
    </View>
  );
}
