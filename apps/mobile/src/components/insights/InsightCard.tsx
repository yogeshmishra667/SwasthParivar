// Phase 2 — Insight feed card. Each insight renders its pattern type,
// severity chip, body copy, and acknowledge / helpful actions. The
// server already filters confidence ≥ 0.7 so we never need to gate on
// it here.

import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import type { InsightEventDto, InsightSeverity } from "@/services/insights";
import { acknowledgeInsight } from "@/services/insights";

interface InsightCardProps {
  insight: InsightEventDto;
  onAcknowledged: (id: string) => void;
}

const SEVERITY_COLOR: Record<InsightSeverity, { bg: string; text: string; icon: string }> = {
  info: { bg: "bg-blue-50", text: "text-blue-700", icon: "#2563EB" },
  warn: { bg: "bg-amber-50", text: "text-amber-900", icon: "#D97706" },
  critical: { bg: "bg-red-50", text: "text-critical", icon: "#DC2626" },
};

// Compose a fallback English line from messageParams when no
// translation exists for the messageKey yet. Detector authors may add
// new keys without forcing an i18n rebuild on the mobile side.
const composeFallback = (patternType: string, params: Record<string, unknown>): string => {
  const summary = Object.entries(params)
    .filter(([_, v]) => typeof v === "string" || typeof v === "number")
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" • ");
  return summary ? `${patternType}: ${summary}` : patternType;
};

export const InsightCard = ({ insight, onAcknowledged }: InsightCardProps): JSX.Element => {
  const { t } = useTranslation();
  const [acking, setAcking] = useState(false);

  const sev = SEVERITY_COLOR[insight.severityLevel];
  const titleKey = `insights.type.${insight.patternType}`;
  const messageKey = `insights.messages.${insight.messageKey}`;
  // i18next returns the key when no translation exists; fall back to a
  // compose() so the user never sees a raw key.
  const translated = t(messageKey, { ...insight.messageParams, defaultValue: "" });
  const body =
    translated.length > 0
      ? translated
      : composeFallback(insight.patternType, insight.messageParams);

  const handleAck = async (helpful?: boolean): Promise<void> => {
    if (acking) return;
    setAcking(true);
    const result = await acknowledgeInsight(insight.id, helpful);
    setAcking(false);
    if (result) onAcknowledged(insight.id);
  };

  return (
    <Card className={`border ${sev.bg.replace("bg-", "border-")}/40 ${sev.bg}`}>
      <View className="flex-row items-center gap-2">
        <Icon name="alert-circle" size={18} color={sev.icon} />
        <Text className={`text-body font-semibold ${sev.text}`}>{t(titleKey)}</Text>
        <View className="ml-auto rounded-full bg-white/70 px-2 py-0.5">
          <Text className={`text-body ${sev.text}`}>
            {t(`insights.severity.${insight.severityLevel}`)}
          </Text>
        </View>
      </View>
      <Text className="mt-2 text-important text-gray-900">{body}</Text>

      {!insight.acknowledged && (
        <View className="mt-3 flex-row gap-2">
          <View className="flex-1">
            <Button
              label={t("insights.acknowledge")}
              variant="ghost"
              disabled={acking}
              onPress={() => void handleAck()}
            />
          </View>
          <Pressable
            onPress={() => void handleAck(true)}
            disabled={acking}
            accessibilityRole="button"
            accessibilityLabel={t("insights.helpfulYes")}
            style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
            className="items-center justify-center rounded-2xl border border-success bg-green-50 px-4"
          >
            <Text className="text-important text-success">{t("insights.helpfulYes")}</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleAck(false)}
            disabled={acking}
            accessibilityRole="button"
            accessibilityLabel={t("insights.helpfulNo")}
            style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
            className="items-center justify-center rounded-2xl border border-warning bg-amber-50 px-4"
          >
            <Text className="text-important text-warning">{t("insights.helpfulNo")}</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
};
