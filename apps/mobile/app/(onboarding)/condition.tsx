import { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

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
    } catch (e) {
      logError("onboarding/condition", e);
    }
    setSaving(false);
    router.push("/(onboarding)/profile");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        {/* Header */}
        <View className="mb-10 items-center">
          <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
            <Icon name="heart" size={48} color="#2563EB" />
          </View>
          <Text className="text-3xl font-bold tracking-tight text-gray-900">
            {t("onboarding.selectCondition")}
          </Text>
          <Text className="mt-2 text-center text-body text-gray-500">
            {t("onboarding.conditionSubtitle", {
              defaultValue: "Aapki condition chunein taaki hum sahi tracking set kar sakein.",
            })}
          </Text>
        </View>

        {/* Condition */}
        <View className="w-full gap-3">
          <Button
            label={t("onboarding.diabetes")}
            onPress={() => void select("diabetes")}
            disabled={saving}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
