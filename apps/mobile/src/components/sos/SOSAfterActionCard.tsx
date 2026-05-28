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
import { Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

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
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 p-6">
        <View className="items-center">
          <Icon name="checkmark-circle" size={56} color="#16A34A" accessibilityLabel="" />
          <Text className="mt-3 text-hero font-bold text-foreground" accessibilityRole="header">
            {t("sos.after.title")}
          </Text>
          <Text className="mt-2 text-center text-important text-neutral">
            {t("sos.after.subtitle")}
          </Text>
        </View>

        <View className="mt-8 gap-3">
          <Button
            label={t("sos.after.falseAlarmLabel")}
            variant={selection === "false_alarm" ? "primary" : "ghost"}
            onPress={() => {
              setSelection("false_alarm");
            }}
            accessibilityState={{ selected: selection === "false_alarm" }}
          />
          <Button
            label={t("sos.after.genuineLabel")}
            variant={selection === "genuine" ? "primary" : "ghost"}
            onPress={() => {
              setSelection("genuine");
            }}
            accessibilityState={{ selected: selection === "genuine" }}
          />
        </View>

        <View className="mt-6">
          <Text className="text-body font-semibold text-foreground">
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
            className="mt-2 rounded-2xl border border-neutral bg-white p-3 text-important text-foreground"
            style={{ minHeight: 80, textAlignVertical: "top" }}
            accessibilityLabel={t("sos.after.noteLabel")}
          />
        </View>

        <View className="mt-auto w-full gap-3">
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
          />
          <Button label={t("sos.after.skipButton")} variant="ghost" onPress={onSkip} />
        </View>
      </View>
    </SafeAreaView>
  );
};
