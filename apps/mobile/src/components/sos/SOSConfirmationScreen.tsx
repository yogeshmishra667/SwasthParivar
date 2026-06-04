import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
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

  // Steady breathing ring glow — not distracting, just alive
  const ringGlow = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(ringGlow, {
          toValue: 0.45,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringGlow, {
          toValue: 0.15,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [ringGlow]);

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

  // Progress: thin red arc indicator (elapsed as a percentage for width)
  const progressWidth = `${Math.round(elapsed * 100)}%` as const;

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-1 items-center justify-between px-6 py-8">
        {/* Header */}
        <View className="w-full items-center">
          <View className="flex-row items-center gap-2 rounded-full bg-red-950/50 border border-red-900/40 px-5 py-2">
            <Icon name="warning" size={14} color="#EF4444" accessibilityLabel="" />
            <Text className="text-xs font-bold uppercase tracking-widest text-red-400">
              {t("sos.confirm.title")}
            </Text>
          </View>

          {testMode ? (
            <View className="mt-3 flex-row items-center gap-2 rounded-full bg-amber-950/50 border border-amber-800/30 px-4 py-1.5">
              <View className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <Text className="text-xs font-bold uppercase tracking-wider text-amber-400">
                {t("sos.confirm.testMode")}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Countdown centrepiece */}
        <View className="items-center">
          <View className="items-center justify-center" style={{ height: 200, width: 200 }}>
            {/* Outer breathing glow ring */}
            <Animated.View
              style={{
                position: "absolute",
                height: 200,
                width: 200,
                borderRadius: 100,
                borderWidth: 3,
                borderColor: "#EF4444",
                opacity: ringGlow,
              }}
            />
            {/* Static inner ring */}
            <View
              style={{
                height: 180,
                width: 180,
                borderRadius: 90,
                borderWidth: 2,
                borderColor: "rgba(239, 68, 68, 0.25)",
                backgroundColor: "rgba(239, 68, 68, 0.04)",
              }}
              className="items-center justify-center"
            >
              <Text
                style={{ fontSize: 84, lineHeight: 92, color: "#FFFFFF" }}
                className="font-black"
                accessibilityLiveRegion="polite"
                accessibilityLabel={t("sos.confirm.description", { seconds: remaining })}
              >
                {remaining}
              </Text>
            </View>
          </View>

          <Text
            className="mt-6 text-center text-lg font-bold text-white px-2"
            style={{ lineHeight: 26 }}
          >
            {t("sos.confirm.description", { seconds: remaining })}
          </Text>

          {/* Thin progress bar */}
          <View className="mt-5 w-full h-1 rounded-full bg-slate-800 overflow-hidden">
            <View
              style={{ width: progressWidth, backgroundColor: "#EF4444" }}
              className="h-full rounded-full"
            />
          </View>
        </View>

        {/* Actions — Cancel is primary (safe), Confirm is secondary (dangerous) */}
        <View className="w-full gap-3">
          <Button
            label={t("sos.confirm.cancelButton")}
            variant="ghost"
            accessibilityLabel={t("sos.confirm.cancelButton")}
            onPress={onCancel}
            style={{
              backgroundColor: "#1E293B",
              minHeight: 60,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#334155",
            }}
            textStyle={{ color: "#F1F5F9", fontSize: 17, fontWeight: "700" }}
          />
          <Button
            label={t("sos.confirm.confirmButton")}
            variant="critical"
            onPress={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              onConfirm();
            }}
            style={{
              minHeight: 60,
              borderRadius: 16,
              backgroundColor: "#DC2626",
            }}
            textStyle={{ fontSize: 17, fontWeight: "700" }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
