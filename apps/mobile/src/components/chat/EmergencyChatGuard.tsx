// Phase 3 — AI Chat: emergency guard (phase3.md M.1).
// When a critical-bypass is active the patient must handle that first —
// chat is intercepted entirely and replaced with a redirect to the
// critical-alert screen. Mirrors the server's emergency-skip behaviour.

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { EmergencyChatGuardProps } from "./types";

export const EmergencyChatGuard = ({
  criticalBypassActive,
  onResolveCritical,
  children,
}: EmergencyChatGuardProps): JSX.Element => {
  const { t } = useTranslation();

  if (!criticalBypassActive) return <>{children}</>;

  return (
    <View
      className="flex-1 items-center justify-center bg-critical/10 p-6"
      accessibilityRole="alert"
    >
      <Text className="mb-4 text-center text-important font-semibold text-critical">
        {t("chat.emergencySkip")}
      </Text>
      <Pressable
        onPress={onResolveCritical}
        accessibilityRole="button"
        accessibilityLabel={t("chat.emergencyResolve")}
        className="min-h-touch min-w-touch items-center justify-center rounded-2xl bg-critical px-6 active:opacity-80"
      >
        <Text className="text-important font-semibold text-white">
          {t("chat.emergencyResolve")}
        </Text>
      </Pressable>
    </View>
  );
};
