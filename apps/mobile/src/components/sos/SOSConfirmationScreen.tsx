// Phase 4 Feature D' — SOSConfirmationScreen.
//
// 3-second countdown after the button is armed. The "Send now" button
// is the explicit positive action; the "Cancel" button is the easy
// out (left side, larger). Auto-confirms when the countdown reaches
// 0 — silence is consent here, because the patient already long-
// pressed the SOS button.
//
// Edge cases covered:
//  - Cancellation during countdown: instant exit, no analytics noise
//  - Server failure on confirm: parent surfaces "unavailable, dial
//    directly" copy (sos.error.unavailable)
//  - Test mode: explicit badge so internal users can drill safely
//    without thinking they're paging on-call
//
// Layout follows CLAUDE.md: 48dp+ targets, high contrast (red bg,
// white text, single big number).

import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { hapticWarning } from "@/utils/haptics";

const COUNTDOWN_SECONDS = 3;

interface SOSConfirmationScreenProps {
  testMode: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SOSConfirmationScreen = ({
  testMode,
  onConfirm,
  onCancel,
}: SOSConfirmationScreenProps): JSX.Element => {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const firedRef = useRef(false);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, COUNTDOWN_SECONDS - elapsed);
      setRemaining(next);
      if (next === 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(tick);
        hapticWarning();
        onConfirm();
      }
    }, 100);

    return () => {
      clearInterval(tick);
    };
  }, [onConfirm]);

  return (
    <SafeAreaView className="flex-1 bg-critical">
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-hero font-bold text-white" accessibilityRole="header">
          {t("sos.confirm.title")}
        </Text>

        <View className="my-8 h-32 w-32 items-center justify-center rounded-full bg-white">
          <Text
            className="text-white"
            style={{ fontSize: 80, lineHeight: 96, color: "#DC2626" }}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${remaining} seconds`}
          >
            {remaining}
          </Text>
        </View>

        <Text className="text-center text-important text-white">
          {t("sos.confirm.description", { seconds: remaining })}
        </Text>

        {testMode ? (
          <View className="mt-4 rounded-md border border-white bg-white/20 px-3 py-2">
            <Text className="text-body text-white">{t("sos.confirm.testMode")}</Text>
          </View>
        ) : null}

        <View className="mt-8 w-full gap-3">
          <Button
            label={t("sos.confirm.cancelButton")}
            variant="ghost"
            onPress={onCancel}
            // Explicit accessibility label — the variant background is
            // transparent over the red screen, which can read as
            // "blank button" without it.
            accessibilityLabel={t("sos.confirm.cancelButton")}
            style={{ backgroundColor: "#FFFFFF" }}
          />
          <Button
            label={t("sos.confirm.confirmButton")}
            variant="primary"
            onPress={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              onConfirm();
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
