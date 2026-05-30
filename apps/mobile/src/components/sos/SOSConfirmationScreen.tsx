// Phase 4 Feature D' — SOSConfirmationScreen.
//
// Visual: soft red background with a single elevated white card holding
// the countdown and the description. Less "panic alarm" than the
// previous solid-red full bleed; an elderly patient who tapped by
// accident should still recognise this as serious but not feel they're
// already in an irreversible flow.
//
// Behaviour (unchanged from initial PR):
//  - 3-second countdown; auto-confirms at 0 (silence = consent because
//    the patient already long-pressed SOS to get here)
//  - "Cancel" is the easier / more prominent action — it's on the left
//    and uses a white surface
//  - "Send now" is the explicit positive action — patient may not want
//    to wait the full 3 seconds
//  - Test-mode badge surfaces above the countdown so internal users
//    drilling SOS can tell the difference at a glance

import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { hapticWarning } from "@/utils/haptics";

const COUNTDOWN_SECONDS = 3;
const TICK_MS = 100;

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
  const [elapsed, setElapsed] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const ms = Date.now() - startedAt;
      const secondsElapsed = Math.floor(ms / 1000);
      const next = Math.max(0, COUNTDOWN_SECONDS - secondsElapsed);
      setElapsed(Math.min(1, ms / (COUNTDOWN_SECONDS * 1000)));
      setRemaining(next);
      if (next === 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(tick);
        hapticWarning();
        onConfirm();
      }
    }, TICK_MS);

    return () => {
      clearInterval(tick);
    };
  }, [onConfirm]);

  const progressPct = Math.round(elapsed * 100);

  return (
    <SafeAreaView className="flex-1 bg-red-50">
      <View className="flex-1 items-center justify-between p-6">
        {/* Header chip — sets the tone without screaming. */}
        <View className="w-full flex-row items-center justify-center gap-2 rounded-full bg-white py-2 shadow-sm">
          <Icon name="warning" size={16} color="#DC2626" accessibilityLabel="" />
          <Text className="text-xs font-semibold uppercase tracking-wider text-red-700">
            {t("sos.confirm.title")}
          </Text>
        </View>

        {/* Centerpiece — countdown card. */}
        <View className="w-full items-center rounded-3xl border border-red-100 bg-white p-6 shadow-md">
          {testMode ? (
            <View className="mb-4 flex-row items-center gap-1 rounded-full bg-amber-100 px-3 py-1">
              <View
                style={{
                  height: 6,
                  width: 6,
                  borderRadius: 3,
                  backgroundColor: "#D97706",
                }}
              />
              <Text className="text-xs font-semibold uppercase text-amber-700">
                {t("sos.confirm.testMode")}
              </Text>
            </View>
          ) : null}

          {/* Countdown disc — solid red surface with a white inner ring
              that shrinks as time elapses. The visual metaphor is a
              draining timer, not a ticking bomb. */}
          <View
            style={{
              height: 160,
              width: 160,
              borderRadius: 80,
              backgroundColor: "#DC2626",
              shadowColor: "#7F1D1D",
              shadowOpacity: 0.3,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
            className="items-center justify-center"
          >
            <View
              style={{
                height: 140 - progressPct,
                width: 140 - progressPct,
                borderRadius: 80,
                backgroundColor: "rgba(255,255,255,0.18)",
              }}
              className="absolute"
              pointerEvents="none"
            />
            <Text
              style={{ fontSize: 80, lineHeight: 88, color: "#FFFFFF" }}
              className="font-bold"
              accessibilityLiveRegion="polite"
              accessibilityLabel={t("sos.confirm.description", { seconds: remaining })}
            >
              {remaining}
            </Text>
          </View>

          <Text className="mt-6 text-center text-important font-medium text-foreground">
            {t("sos.confirm.description", { seconds: remaining })}
          </Text>
          <Text className="mt-2 text-center text-body text-neutral">{t("sos.confirm.title")}</Text>
        </View>

        {/* Action row — cancel sized larger to bias toward the safer
            action while still keeping "Send now" reachable for a
            patient who knows they need help immediately. */}
        <View className="w-full gap-3">
          <Button
            label={t("sos.confirm.cancelButton")}
            variant="ghost"
            accessibilityLabel={t("sos.confirm.cancelButton")}
            onPress={onCancel}
            style={{ backgroundColor: "#FFFFFF", minHeight: 56 }}
          />
          <Button
            label={t("sos.confirm.confirmButton")}
            variant="critical"
            onPress={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              onConfirm();
            }}
            style={{ minHeight: 56 }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
