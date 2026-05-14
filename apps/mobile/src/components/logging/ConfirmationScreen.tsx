import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { isCriticalGlucose } from "@swasth/shared-types";
import type { GlucoseReadingType } from "@swasth/shared-types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useProfileStore, isRecentSwitch } from "@/stores/profile.store";
import { useFestiveStore, FESTIVE_MAX_PER_WEEK } from "@/stores/festive.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { track } from "@/services/analytics";

export type ReadingContext = "normal" | "festive";

interface ConfirmationProps {
  value: number;
  type: GlucoseReadingType;
  uncertainType: boolean;
  onConfirm: (type: GlucoseReadingType, context: ReadingContext) => void;
  onEdit: () => void;
}

const TYPE_OPTIONS: readonly GlucoseReadingType[] = ["fasting", "post_meal", "random"] as const;

const TYPE_LABELS: Record<GlucoseReadingType, string> = {
  fasting: "Fasting",
  pre_meal: "Khane se pehle",
  post_meal: "Post-meal",
  random: "Random",
  bedtime: "Sone se pehle",
};

const TYPE_HINTS: Record<GlucoseReadingType, string> = {
  fasting: "Subah, khaali pet",
  pre_meal: "Khane se pehle",
  post_meal: "Khane ke 2hr baad",
  random: "Kisi bhi time",
  bedtime: "Sone se pehle",
};

const EXTREME_CONFIRM_DELAY_MS = 3000;

export const ConfirmationScreen = ({
  value,
  type,
  uncertainType,
  onConfirm,
  onEdit,
}: ConfirmationProps): JSX.Element => {
  const { t } = useTranslation();
  const profile = useActiveProfile();
  const [selectedType, setSelectedType] = useState<GlucoseReadingType>(type);
  const [isFestive, setIsFestive] = useState(false);
  const recentSwitch = useProfileStore(isRecentSwitch);
  const festiveCanUse = useFestiveStore((s) => s.canUseFestive());
  const festiveUsedThisWeek = useFestiveStore((s) => s.recentUses());
  const recordFestiveUse = useFestiveStore((s) => s.recordUse);
  const isCritical = isCriticalGlucose(value);
  const [confirmReady, setConfirmReady] = useState(!isCritical);

  useEffect(() => {
    if (!isCritical) return;
    const id = setTimeout(() => setConfirmReady(true), EXTREME_CONFIRM_DELAY_MS);
    return () => clearTimeout(id);
  }, [isCritical]);

  // Critical values ignore the festive toggle entirely — safety doesn't
  // bend for celebrations. Mirrors the engine rule in feedback-engine.
  const festiveAvailable = !isCritical && festiveCanUse;
  const festiveActive = isFestive && festiveAvailable;

  const handleConfirm = (): void => {
    if (festiveActive) {
      recordFestiveUse();
      track("festive_tag_used", { used_this_week: festiveUsedThisWeek + 1 });
    }
    onConfirm(selectedType, festiveActive ? "festive" : "normal");
  };

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
                  ? `${profile.name} ji ke liye save ho raha hai`
                  : "Aapke liye save ho raha hai"}
              </Text>
            </View>
            {recentSwitch && (
              <Text className="mt-1 text-body text-warning">
                Abhi-abhi profile switch kiya — sahi profile hai na?
              </Text>
            )}
          </Card>

          <Card>
            <Text className="text-body text-neutral">Glucose reading</Text>
            <View className="mt-1 flex-row items-baseline gap-2">
              <Text
                className={`text-5xl font-bold tracking-tight ${
                  isCritical ? "text-critical" : "text-gray-900"
                }`}
              >
                {value}
              </Text>
              <Text className="text-important text-neutral">mg/dL</Text>
            </View>
            {isCritical && (
              <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
                <Icon name="warning" size={20} color="#DC2626" />
                <Text className="flex-1 text-important font-bold text-critical">
                  Yeh bahut {value > 315 ? "zyada" : "kam"} hai. Kya sahi hai?
                </Text>
              </View>
            )}
          </Card>

          <Card>
            <Text className="mb-3 text-body text-neutral">
              {uncertainType ? "Fasting ya post-meal? Tap karein:" : "Reading type"}
            </Text>
            <View className="gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const active = selectedType === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setSelectedType(opt)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={{ minHeight: TOUCH_TARGET_MIN }}
                    className={`flex-row items-center justify-between rounded-xl border px-4 py-3 ${
                      active ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"
                    }`}
                  >
                    <View className="flex-1 pr-3">
                      <Text
                        className={`text-important font-semibold ${
                          active ? "text-blue-700" : "text-gray-900"
                        }`}
                      >
                        {TYPE_LABELS[opt] ?? opt}
                      </Text>
                      <Text className="mt-0.5 text-body text-neutral">{TYPE_HINTS[opt] ?? ""}</Text>
                    </View>
                    <View
                      className={`h-5 w-5 items-center justify-center rounded-full border-2 ${
                        active ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"
                      }`}
                    >
                      {active && <View className="h-2 w-2 rounded-full bg-white" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* Festive toggle. Hidden when critical (safety wins) or when
          the user has burned both weekly slots — see CLAUDE.md "Festive
          Tag: Disable After Limit". */}
          {!isCritical && (
            <Card>
              <Pressable
                onPress={() => festiveAvailable && setIsFestive((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: festiveActive, disabled: !festiveAvailable }}
                disabled={!festiveAvailable}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="flex-row items-center justify-between"
              >
                <View className="flex-1 pr-3">
                  <Text
                    className={`text-important font-semibold ${
                      festiveAvailable ? "" : "text-neutral"
                    }`}
                  >
                    🎉 {t("logging.festiveToggle", { defaultValue: "Special din?" })}
                  </Text>
                  {!festiveCanUse ? (
                    <Text className="mt-1 text-body text-neutral">
                      {t("logging.festiveLimitReached", {
                        defaultValue: "Is hafte 2 baar use ho chuka. Kal se phir.",
                      })}
                    </Text>
                  ) : (
                    <Text className="mt-1 text-body text-neutral">
                      {t("logging.festiveHint", {
                        used: festiveUsedThisWeek,
                        max: FESTIVE_MAX_PER_WEEK,
                        defaultValue: `Festival ho to enable karein (${festiveUsedThisWeek}/${FESTIVE_MAX_PER_WEEK} this week)`,
                      })}
                    </Text>
                  )}
                </View>
                <View
                  className={`h-7 w-12 items-${festiveActive ? "end" : "start"} justify-center rounded-full px-1 ${
                    festiveActive ? "bg-celebration" : "bg-gray-300"
                  } ${festiveAvailable ? "" : "opacity-40"}`}
                >
                  <View className="h-5 w-5 rounded-full bg-white" />
                </View>
              </Pressable>
            </Card>
          )}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button label="Edit" variant="ghost" onPress={onEdit} />
            </View>
            <View className="flex-[2]">
              <Button
                label={confirmReady ? "Haan, save" : "Wait..."}
                variant={isCritical ? "critical" : "primary"}
                disabled={!confirmReady}
                onPress={handleConfirm}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
