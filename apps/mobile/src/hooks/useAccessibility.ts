import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import { usePreferencesStore } from "@/stores/preferences.store";
import { LARGE_TEXT_SCALE } from "@/utils/constants";

/**
 * Tracks the OS reduce-motion preference into the preferences store.
 * Font scaling is handled at the tree root by `<FontScaleProvider>`,
 * which feeds NativeWind CSS variables consumed by `text-*` utility
 * classes — that mechanism applies the toggle to all rendered Text.
 */
export const useAccessibility = (): void => {
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, [setReduceMotion]);
};

export const useFontScale = (): number => {
  const largeText = usePreferencesStore((s) => s.largeText);
  return largeText ? LARGE_TEXT_SCALE : 1;
};
