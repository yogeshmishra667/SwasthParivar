import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { saveGlucoseReading } from "@/services/readings";
import { useAuthStore } from "@/stores/auth.store";
import { hapticCelebrate } from "@/utils/haptics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import type { GlucoseReadingType } from "@swasth/shared-types";

export default function FirstReadingScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [value, setValue] = useState<number | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveReading = async (
    type: GlucoseReadingType,
    context: "normal" | "festive",
  ): Promise<void> => {
    if (value === null || saving || !userId) return;
    setSaving(true);

    // Single source of truth for the save: routes through
    // `saveGlucoseReading` which handles online + offline-queue paths,
    // so the onboarding flow always advances even on poor networks.
    const result = await saveGlucoseReading({
      userId,
      valueMgDl: value,
      readingType: type,
      context,
      source: "manual",
      measuredAtIso: new Date().toISOString(),
    });

    if (result.kind === "rejected") {
      logError("onboarding/first-reading", new Error(result.message));
      // Stay on the confirmation; user can edit + retry. Falling
      // through would skip celebration AND advance the step.
      setSaving(false);
      return;
    }

    // Best-effort onboarding-step bump — if the patch fails (truly
    // offline), the next dashboard mount also reads /users/me and
    // routes to the right step.
    try {
      await api.patch("/users/me", { onboardingStep: 4 });
    } catch (e) {
      logError("onboarding/first-reading.step", e);
    }

    setSaving(false);
    setSavedOffline(result.kind === "queued");
    hapticCelebrate();
    setCelebrated(true);
  };

  if (celebrated) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-white p-6">
        <Icon name="trophy" size={72} color="#8B5CF6" accessibilityLabel="Celebration" />
        <Text className="text-hero font-bold text-center">{t("onboarding.celebrate")}</Text>
        {savedOffline && (
          <Text className="text-body text-warning text-center">
            {t("logging.savedOffline")}
          </Text>
        )}
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
      onConfirm={(type, ctx) => void saveReading(type, ctx)}
      onEdit={() => setValue(null)}
    />
  );
}
