import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import { usePreferencesStore } from "@/stores/preferences.store";

export const useAccessibility = (): void => {
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, [setReduceMotion]);
};
