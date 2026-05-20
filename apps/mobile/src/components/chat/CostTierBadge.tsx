// Phase 3 — AI Chat: cost-tier badge (phase3.md M.1).
// Shows which response tier produced a message (template / cached /
// sonnet). Diagnostic only — hidden outside dev builds so patients
// never see it. `visible` defaults to React Native's `__DEV__`.

import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChatTier } from "@/services/chat";

interface CostTierBadgeProps {
  tier: ChatTier;
  visible?: boolean;
}

export const CostTierBadge = ({
  tier,
  visible = __DEV__,
}: CostTierBadgeProps): JSX.Element | null => {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View className="rounded bg-gray-200 px-1.5 py-0.5">
      <Text className="text-body text-gray-600">{t(`chat.tier.${tier}`)}</Text>
    </View>
  );
};
