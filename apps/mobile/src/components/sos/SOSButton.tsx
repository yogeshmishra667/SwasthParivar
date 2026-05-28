// Phase 4 Feature D' — SOSButton.
//
// Always visible on the patient home screen. Long-press for 1s to
// arm the confirmation flow (phase3.md §M.4: prevents accidental
// touches in pocket / sleeve). 48dp+ touch target with continuous
// visual + haptic feedback during the hold so an elderly user can
// tell the press is registering.
//
// Cross-cutting design:
//  - NEVER a single-tap trigger (CLAUDE.md "Critical Bypass" /
//    elderly accessibility — accidental taps are common).
//  - Hold duration ≥ 1s + a separate 3s confirmation countdown
//    (SOSConfirmationScreen) before the actual server call. Two
//    "are you sure" gates by design.
//  - On release before 1s: cancel silently — no nag, no analytics
//    event (it was probably a brush).

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, AccessibilityInfo } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { hapticCritical, hapticWarning } from "@/utils/haptics";

const ARM_HOLD_MS = 1_000;
const TICK_MS = 50;

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
        // Announce for screen readers — elderly users on Talkback rely
        // on this confirmation.
        AccessibilityInfo.announceForAccessibility(t("sos.confirm.title"));
        onArmed();
      }
    }, TICK_MS);
  }, [disabled, onArmed, stopTimers, t]);

  const handlePressOut = useCallback(() => {
    if (firedRef.current) return; // already fired — handled
    stopTimers();
    setHolding(false);
    setProgress(0);
  }, [stopTimers]);

  // Visual progress: shrink the inner ring as the hold completes.
  const ringScale = 1 - 0.3 * progress;

  return (
    <View className="items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("sos.button.label")}
        accessibilityHint={t("sos.button.hint")}
        accessibilityState={{ disabled, busy: holding }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        style={{ minHeight: TOUCH_TARGET_MIN * 2, minWidth: TOUCH_TARGET_MIN * 2 }}
        className={`h-32 w-32 items-center justify-center rounded-full ${
          disabled ? "bg-gray-300" : "bg-critical active:bg-red-700"
        }`}
      >
        <View
          style={{ transform: [{ scale: ringScale }] }}
          className="h-24 w-24 items-center justify-center rounded-full border-4 border-white"
        >
          <Icon name="warning" size={36} color="#FFFFFF" accessibilityLabel="" />
          <Text className="mt-1 text-important font-bold text-white">SOS</Text>
        </View>
      </Pressable>
      {holding ? (
        <Text className="mt-2 text-body text-critical font-semibold">
          {t("sos.button.longPressHelp")}
        </Text>
      ) : (
        <Text className="mt-2 text-body text-neutral">{t("sos.button.hint")}</Text>
      )}
    </View>
  );
};
