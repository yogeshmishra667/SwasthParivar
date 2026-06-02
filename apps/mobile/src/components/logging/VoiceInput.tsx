import { useEffect, useState, type ComponentType } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import type { VoiceParseResult } from "@swasth/domain-logic";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { isExpoGo } from "@/utils/runtime";

interface VoiceInputProps {
  onParsed: (result: VoiceParseResult) => void;
  onFail: () => void;
}

// `expo-speech-recognition` uses `requireNativeModule` at import time.
// In Expo Go on Android the native module isn't present and the import
// crashes the bundle, so we lazy-load the implementation only when the
// runtime supports it (any custom dev build, or Expo Go on iOS).
const voiceUnavailable = isExpoGo && Platform.OS === "android";

const VoiceUnavailable = ({ onFail }: VoiceInputProps): JSX.Element => {
  const { t } = useTranslation();
  // Auto-fall back so the screen lands on numpad without an extra tap.
  useEffect(() => {
    onFail();
  }, [onFail]);

  return (
    <View className="items-center gap-3">
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={t("voice.devBuildRequired")}
        className="items-center justify-center rounded-full bg-gray-300"
        style={{
          width: TOUCH_TARGET_MIN * 2.5,
          height: TOUCH_TARGET_MIN * 2.5,
        }}
      >
        <Icon name="mic-off" size={48} color="#FFFFFF" />
      </Pressable>
      <Text className="text-important text-center px-4 text-gray-900 dark:text-gray-100">
        {t("voice.devBuildRequired")}
      </Text>
    </View>
  );
};

export const VoiceInput = (props: VoiceInputProps): JSX.Element => {
  const [Native, setNative] = useState<ComponentType<VoiceInputProps> | null>(null);

  useEffect(() => {
    if (voiceUnavailable) return;
    let cancelled = false;
    void import("./VoiceInputNative").then((mod) => {
      if (!cancelled) setNative(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (voiceUnavailable) return <VoiceUnavailable {...props} />;
  if (!Native) {
    return (
      <View className="items-center gap-3">
        <View
          className="items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700"
          style={{
            width: TOUCH_TARGET_MIN * 2.5,
            height: TOUCH_TARGET_MIN * 2.5,
          }}
        >
          <Icon name="mic" size={48} color="#9CA3AF" />
        </View>
        <Text className="text-important text-center text-gray-900 dark:text-gray-100">
          Loading...
        </Text>
      </View>
    );
  }
  return <Native {...props} />;
};
