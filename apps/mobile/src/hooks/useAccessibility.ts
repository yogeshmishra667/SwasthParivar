import { useEffect } from "react";
import { AccessibilityInfo, Text, type TextProps } from "react-native";
import { usePreferencesStore } from "@/stores/preferences.store";
import { FONT_SIZE, LARGE_TEXT_SCALE } from "@/utils/constants";

type TextWithDefaults = typeof Text & { defaultProps?: TextProps };

export const useAccessibility = (): void => {
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);
  const largeText = usePreferencesStore((s) => s.largeText);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, [setReduceMotion]);

  useEffect(() => {
    const scale = largeText ? LARGE_TEXT_SCALE : 1;
    const TextDefaults = Text as TextWithDefaults;
    TextDefaults.defaultProps = TextDefaults.defaultProps ?? {};
    TextDefaults.defaultProps.allowFontScaling = true;
    TextDefaults.defaultProps.style = { fontSize: FONT_SIZE.body * scale };
  }, [largeText]);
};

export const useFontScale = (): number => {
  const largeText = usePreferencesStore((s) => s.largeText);
  return largeText ? LARGE_TEXT_SCALE : 1;
};
