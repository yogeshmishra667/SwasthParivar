import { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

export default function MedicationsOnboarding(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const completeOnboarding = async (destination: "dashboard" | "medications"): Promise<void> => {
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
    router.replace(
      destination === "medications" ? "/(tabs)/medications" : "/(tabs)/dashboard",
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        {/* Header */}
        <View className="mb-10 items-center">
          <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
            <Icon name="medkit" size={48} color="#2563EB" />
          </View>
          <Text className="text-3xl font-bold tracking-tight text-gray-900">
            {t("onboarding.addMedicines")}
          </Text>
          <Text className="mt-2 text-center text-body text-gray-500">
            {t("onboarding.addMedicinesLater")}
          </Text>
        </View>

        {/* Actions */}
        <View className="w-full gap-3">
          <Button
            label={t("medications.addMedicines")}
            onPress={() => void completeOnboarding("medications")}
            disabled={saving}
          />
          <Button
            label={t("common.skip")}
            variant="ghost"
            onPress={() => void completeOnboarding("dashboard")}
            disabled={saving}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
