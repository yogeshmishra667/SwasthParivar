import { useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { hapticCelebrate } from "@/utils/haptics";

export default function FirstReadingScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState<number | null>(null);
  const [celebrated, setCelebrated] = useState(false);

  if (celebrated) {
    return (
      <View className="flex-1 items-center justify-center bg-white gap-4 p-6">
        <Text className="text-hero">🎉</Text>
        <Text className="text-hero font-bold">{t("onboarding.celebrate")}</Text>
        <Text
          className="mt-4 text-important text-primary underline"
          onPress={() => router.push("/(onboarding)/medications")}
        >
          Agay badhein →
        </Text>
      </View>
    );
  }

  if (value === null) {
    return (
      <View className="flex-1 bg-white p-6">
        <Text className="mb-4 text-hero font-bold">{t("onboarding.firstReading")}</Text>
        <NumpadInput onSubmit={setValue} />
      </View>
    );
  }

  return (
    <ConfirmationScreen
      value={value}
      type="fasting"
      uncertainType={false}
      onConfirm={() => {
        hapticCelebrate();
        setCelebrated(true);
      }}
      onEdit={() => setValue(null)}
    />
  );
}
