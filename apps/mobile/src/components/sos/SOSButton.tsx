// Phase 4 Feature D' — SOSButton.
//
// Visual: clinical card with a subtle red accent in the resting state.
// The button is the visual anchor of an otherwise-calm card so the
// elderly user perceives it as a deliberate, professional emergency
// surface rather than a panic-button toy.
//
// Behaviour (unchanged from the initial PR):
//  - 1-second long-press to arm the confirmation flow (prevents
//    accidental triggers in pocket / sleeve)
//  - On release before 1s: cancel silently — no nag, no analytics
//  - Progress fill animates around the inner circle while held so the
//    patient can tell the press is registering
//  - 48dp+ touch target enforced via min size, NOT just padding
//  - Continuous haptic ramp: warning on press-in, critical on arm

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, AccessibilityInfo } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { hapticCritical, hapticWarning } from "@/utils/haptics";

const ARM_HOLD_MS = 1_000;
const TICK_MS = 50;

// Outer ring is the 48dp+ touch target. The inner pressable circle
// shrinks slightly while held to confirm the press is being read.
const OUTER_DIAMETER = 132;
const INNER_DIAMETER = 96;

interface SOSButtonProps {
  onArmed: () => void;
  /** Hide / shrink the visual when an SOS is already active so the
   *  patient sees the fullscreen overlay, not the button. */
  disabled?: boolean;
}

export const SOSButton = ({ onArmed, disabled = false }: SOSButtonProps): JSX.Element => {
  const { t } = useTranslation();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  const stopTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    firedRef.current = false;
    startedAtRef.current = Date.now();
    setHolding(true);
    setProgress(0);
    hapticWarning();

    tickRef.current = setInterval(() => {
      const start = startedAtRef.current;
      if (start === null) return;
      const elapsed = Date.now() - start;
      const pct = Math.min(1, elapsed / ARM_HOLD_MS);
      setProgress(pct);
      if (pct >= 1 && !firedRef.current) {
        firedRef.current = true;
        stopTimers();
        setHolding(false);
        setProgress(0);
        hapticCritical();
        AccessibilityInfo.announceForAccessibility(t("sos.confirm.title"));
        onArmed();
      }
    }, TICK_MS);
  }, [disabled, onArmed, stopTimers, t]);

  const handlePressOut = useCallback(() => {
    if (firedRef.current) return;
    stopTimers();
    setHolding(false);
    setProgress(0);
  }, [stopTimers]);

  // Visual feedback while held: inner circle shrinks subtly + a red
  // progress ring rises around it. Both are layered absolutely on top
  // of the resting circle so the layout never reflows.
  const innerScale = 1 - 0.06 * progress;
  const ringOpacity = 0.15 + 0.6 * progress;

  return (
    <View className="w-full rounded-3xl border border-red-100 bg-white p-5 shadow-sm">
      <View className="mb-4 flex-row items-center justify-between">
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wider text-red-700">
            {t("sos.button.label")}
          </Text>
          <Text className="mt-1 text-body text-neutral">{t("sos.button.hint")}</Text>
        </View>
        <View className="rounded-full bg-red-50 px-3 py-1">
          <Text className="text-xs font-medium text-red-700">24/7</Text>
        </View>
      </View>

      <View className="items-center py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sos.button.label")}
          accessibilityHint={t("sos.button.hint")}
          accessibilityState={{ disabled, busy: holding }}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled}
          style={{
            height: OUTER_DIAMETER,
            width: OUTER_DIAMETER,
            minHeight: TOUCH_TARGET_MIN * 2,
            minWidth: TOUCH_TARGET_MIN * 2,
          }}
          className="items-center justify-center"
        >
          {/* Resting halo — soft red wash that grows visible while held. */}
          <View
            style={{
              position: "absolute",
              height: OUTER_DIAMETER,
              width: OUTER_DIAMETER,
              borderRadius: OUTER_DIAMETER / 2,
              backgroundColor: "#FEE2E2",
              opacity: ringOpacity,
            }}
            pointerEvents="none"
          />
          {/* Inner solid circle — the visible button itself. */}
          <View
            style={{
              height: INNER_DIAMETER,
              width: INNER_DIAMETER,
              borderRadius: INNER_DIAMETER / 2,
              transform: [{ scale: innerScale }],
              backgroundColor: disabled ? "#D1D5DB" : "#DC2626",
              shadowColor: "#7F1D1D",
              shadowOpacity: disabled ? 0 : 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: disabled ? 0 : 6,
            }}
            className="items-center justify-center"
          >
            <Icon name="warning" size={32} color="#FFFFFF" accessibilityLabel="" />
            <Text className="mt-1 text-sm font-bold tracking-wider text-white">SOS</Text>
          </View>
        </Pressable>
      </View>

      <View className="mt-3 flex-row items-center justify-center gap-1.5">
        <View
          style={{
            height: 6,
            width: 6,
            borderRadius: 3,
            backgroundColor: holding ? "#DC2626" : "#9CA3AF",
          }}
        />
        <Text
          className={`text-body ${holding ? "font-semibold text-red-700" : "text-neutral"}`}
          accessibilityLiveRegion="polite"
        >
          {holding ? t("sos.button.longPressHelp") : t("sos.button.hint")}
        </Text>
      </View>
    </View>
  );
};
