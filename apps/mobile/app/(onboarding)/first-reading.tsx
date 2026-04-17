import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { hapticCelebrate } from "@/utils/haptics";
import { track } from "@/services/analytics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import type { GlucoseReadingType } from "@swasth/shared-types";

export default function FirstReadingScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState<number | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveReading = async (type: GlucoseReadingType): Promise<void> => {
    if (value === null || saving) return;
    setSaving(true);
    try {
      await api.post("/readings/glucose", {
        clientUuid: uuidv4(),
        valueMgDl: value,
        readingType: type,
        source: "manual",
        measuredAt: new Date().toISOString(),
        version: 1,
      });
      track("reading_logged", { type, source: "manual", value });
      await api.patch("/users/me", { onboardingStep: 4 });
    } catch (e) {
      logError("onboarding/first-reading", e);
    }
    setSaving(false);
    hapticCelebrate();
    setCelebrated(true);
  };

  if (celebrated) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-white p-6">
        <Icon name="trophy" size={72} color="#8B5CF6" accessibilityLabel="Celebration" />
        <Text className="text-hero font-bold">{t("onboarding.celebrate")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(onboarding)/medications")}
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="mt-4 items-center justify-center px-4"
        >
          <Text className="text-important font-semibold text-primary underline">
            {t("common.next")}
          </Text>
        </Pressable>
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
      onConfirm={(type) => void saveReading(type)}
      onEdit={() => setValue(null)}
    />
  );
}
