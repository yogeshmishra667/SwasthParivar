import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { NumpadInput } from "@/components/logging/NumpadInput";
import { ConfirmationScreen } from "@/components/logging/ConfirmationScreen";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
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

  // ── Celebration state ──
  if (celebrated) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-6 h-28 w-28 items-center justify-center rounded-full bg-purple-50">
            <Icon name="trophy" size={64} color="#8B5CF6" accessibilityLabel="Celebration" />
          </View>
          <Text className="text-3xl font-bold tracking-tight text-center text-gray-900">
            {t("onboarding.celebrate")}
          </Text>
          <Text className="mt-3 text-center text-body text-gray-500">
            {t("onboarding.celebrateSubtitle", {
              defaultValue: "Bahut acche! Aapne apni pehli reading log kar li. 🎉",
            })}
          </Text>
          {savedOffline && (
            <View className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <Text className="text-body text-amber-800 text-center">
                {t("logging.savedOffline")}
              </Text>
            </View>
          )}
          <View className="mt-8 w-full">
            <Button
              label={t("common.next")}
              onPress={() => router.push("/(onboarding)/medications")}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Numpad entry state ──
  if (value === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View className="mb-6 items-center">
            <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
              <Icon name="fitness" size={48} color="#2563EB" />
            </View>
            <Text className="text-3xl font-bold tracking-tight text-center text-gray-900">
              {t("onboarding.firstReading")}
            </Text>
            <Text className="mt-2 text-center text-body text-gray-500">
              {t("onboarding.firstReadingSubtitle", {
                defaultValue: "Apne glucometer se reading dekhein aur neeche type karein.",
              })}
            </Text>
          </View>

          <NumpadInput onSubmit={setValue} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Confirmation state ──
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }}>
        <ConfirmationScreen
          value={value}
          type="fasting"
          uncertainType={false}
          onConfirm={(type, ctx) => void saveReading(type, ctx)}
          onEdit={() => setValue(null)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

