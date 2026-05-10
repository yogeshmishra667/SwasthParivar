import type { ReactNode } from "react";
import { View } from "react-native";
import { vars } from "nativewind";
import { usePreferencesStore } from "@/stores/preferences.store";
import { FONT_SIZE, LARGE_TEXT_SCALE } from "@/utils/constants";

const px = (n: number): string => `${n}px`;

export const FontScaleProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const largeText = usePreferencesStore((s) => s.largeText);
  const scale = largeText ? LARGE_TEXT_SCALE : 1;

  const themeVars = vars({
    "--fs-body": px(FONT_SIZE.body * scale),
    "--fs-important": px(FONT_SIZE.important * scale),
    "--fs-number": px(FONT_SIZE.number * scale),
    "--fs-hero": px(FONT_SIZE.hero * scale),
  });

  return <View style={[{ flex: 1 }, themeVars]}>{children}</View>;
};
