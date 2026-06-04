// Phase 4 Feature D' — SOSAfterActionCard.
//
// Post-resolve card asking the patient or guardian whether the SOS
// was a false alarm. Drives two product signals at once:
//   1. `false_alarm` on the SOSEvent row → ops dashboard for tuning
//      the trigger heuristics (long-press duration, countdown).
//   2. Optional free-text note for the guardian → goes into the
//      after-action notification (Phase 4 §D'.2 wiring; this PR just
//      records it client-side).
//
// "Skip for now" is a first-class option — an elderly patient who's
// just been through an SOS chain may not feel like answering a
// survey, and forcing them to clears the screen of the panic UI
// without losing the per-event analytics.
//
// Visual: card on a neutral background (not the red SOS overlay) so
// the elderly user feels the situation has visibly de-escalated.

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface SOSAfterActionCardProps {
  onSubmit: (input: { falseAlarm: boolean; note: string | null }) => void;
  onSkip: () => void;
}

export const SOSAfterActionCard = ({ onSubmit, onSkip }: SOSAfterActionCardProps): JSX.Element => {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<"false_alarm" | "genuine" | null>(null);
  const [note, setNote] = useState("");

  const canSubmit = selection !== null;

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-gray-950">
      <View className="flex-1 px-6 py-8 justify-between">
        {/* ── Header — calm, resolved ── */}
        <View className="items-center">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/40">
            <Icon name="checkmark-circle" size={36} color="#10B981" accessibilityLabel="" />
          </View>
          <Text
            className="mt-4 text-center text-xl font-bold text-gray-900 dark:text-gray-100"
            accessibilityRole="header"
          >
            {t("sos.after.title")}
          </Text>
          <Text className="mt-1.5 text-center text-sm text-gray-500 dark:text-gray-400 px-4">
            {t("sos.after.subtitle")}
          </Text>
        </View>

        {/* ── Selection + note ── */}
        <View className="gap-6">
          {/* Choice tiles — simple, clean, single accent. Theme-aware
              via NativeWind dark: variants (was hardcoded #FFFFFF /
              #EFF6FF which was invisible/glaring in dark mode). */}
          <View className="gap-3">
            <ChoiceTile
              label={t("sos.after.falseAlarmLabel")}
              active={selection === "false_alarm"}
              onPress={() => setSelection("false_alarm")}
            />
            <ChoiceTile
              label={t("sos.after.genuineLabel")}
              active={selection === "genuine"}
              onPress={() => setSelection("genuine")}
            />
          </View>

          {/* Note */}
          <View>
            <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("sos.after.noteLabel")}
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("sos.after.notePlaceholder")}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={280}
              numberOfLines={3}
              className="mt-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-gray-100"
              style={{ minHeight: 80, textAlignVertical: "top" }}
              accessibilityLabel={t("sos.after.noteLabel")}
            />
          </View>
        </View>

        {/* ── Actions ── */}
        <View className="w-full gap-3">
          <Button
            label={t("sos.after.submitButton")}
            variant="primary"
            disabled={!canSubmit}
            onPress={() => {
              if (!canSubmit) return;
              onSubmit({
                falseAlarm: selection === "false_alarm",
                note: note.trim().length > 0 ? note.trim() : null,
              });
            }}
            style={{
              minHeight: 56,
              borderRadius: 14,
              opacity: canSubmit ? 1 : 0.45,
            }}
            textStyle={{ fontSize: 16, fontWeight: "700" }}
          />
          <Button
            label={t("sos.after.skipButton")}
            variant="ghost"
            onPress={onSkip}
            style={{ minHeight: 56, borderRadius: 14 }}
            textStyle={{ fontSize: 16, fontWeight: "600" }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

// ── Choice tile ──────────────────────────────────────────────────────
//
// Extracted so the false-alarm / genuine pair share one implementation
// and the styling is theme-aware (was duplicated inline twice with
// hardcoded light colours, broken in dark mode).

interface ChoiceTileProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const ChoiceTile = ({ label, active, onPress }: ChoiceTileProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    style={{ minHeight: TOUCH_TARGET_MIN }}
    className={`flex-row items-center rounded-2xl px-4 py-4 ${
      active
        ? "border-2 border-primary bg-blue-50 dark:bg-blue-950/40"
        : "border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    }`}
  >
    <View
      className={`h-5.5 w-5.5 items-center justify-center rounded-full border-2 ${
        active ? "border-primary bg-primary" : "border-gray-300 bg-transparent dark:border-gray-600"
      }`}
      style={{ height: 22, width: 22 }}
    >
      {active && <View style={{ height: 8, width: 8, borderRadius: 4 }} className="bg-white" />}
    </View>
    <Text
      className={`ml-3 text-base font-semibold ${
        active ? "text-primary dark:text-blue-300" : "text-gray-800 dark:text-gray-200"
      }`}
    >
      {label}
    </Text>
  </Pressable>
);
