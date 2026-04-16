import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";

export default function ConditionScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View className="flex-1 justify-center gap-4 bg-white p-6">
      <Text className="text-hero font-bold">{t("onboarding.selectCondition")}</Text>
      <Button
        label={t("onboarding.diabetes")}
        onPress={() => router.push("/(onboarding)/profile")}
      />
    </View>
  );
}
