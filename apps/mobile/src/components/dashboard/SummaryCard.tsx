// Phase 2 — Hindi/English summary card. The server already composed the
// natural-language sentence via `composeDashboardSummary` (pure
// function from @swasth/domain-logic). The mobile component is a thin
// presentation layer — no copy lives here.

import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

interface SummaryCardProps {
  headline: string;
  details: readonly string[];
  coldStart: boolean;
}

export const SummaryCard = ({ headline, details, coldStart }: SummaryCardProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Card className={coldStart ? "border border-celebration/30 bg-violet-50" : ""}>
      <View className="flex-row items-center gap-2">
        <Icon name="sparkles" size={18} color={coldStart ? "#8B5CF6" : "#2563EB"} />
        <Text className="text-body font-semibold text-neutral">
          {coldStart ? t("summary.coldStartTag") : t("summary.headline")}
        </Text>
      </View>
      <Text className="mt-2 text-2xl font-bold leading-7 text-gray-900">{headline}</Text>
      {details.length > 0 && (
        <View className="mt-3 gap-1.5">
          {details.map((line) => (
            <Text key={line} className="text-important text-gray-700">
              • {line}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
};
