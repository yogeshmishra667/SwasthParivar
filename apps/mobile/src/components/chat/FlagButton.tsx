// Phase 3 — AI Chat: 🚩 flag button (phase3.md M.1).
// Rendered on every assistant message so a patient can always report a
// bad answer. 48dp touch target per the elderly-accessibility floor.

import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

interface FlagButtonProps {
  onPress: () => void;
  flagged?: boolean;
}

export const FlagButton = ({ onPress, flagged = false }: FlagButtonProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("chat.flagDialog.title")}
      accessibilityState={{ selected: flagged }}
      className="min-h-touch min-w-touch items-center justify-center rounded-full active:opacity-60"
      hitSlop={8}
    >
      <Icon
        name={flagged ? "flag" : "flag-outline"}
        size={20}
        color={flagged ? "#DC2626" : "#6B7280"}
      />
    </Pressable>
  );
};
