// Phase 2 — Latest BP card. Mirrors the glucose hero card's shape so
// the dashboard stays visually consistent.

import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

interface BPCardProps {
  latest: {
    systolic: number;
    diastolic: number;
    pulse: number | null;
    measuredAt: string;
  } | null;
}

const HIGH_SYS = 140;
const HIGH_DIA = 90;

export const BPCard = ({ latest }: BPCardProps): JSX.Element => {
  const { t } = useTranslation();
  const elevated = latest !== null && (latest.systolic >= HIGH_SYS || latest.diastolic >= HIGH_DIA);

  return (
    <Card>
      <Text className="text-body text-neutral">{t("bp.latest")}</Text>
      {latest ? (
        <>
          <View className="mt-1 flex-row items-baseline gap-2">
            <Text
              className={`text-4xl font-bold tracking-tight ${
                elevated ? "text-warning" : "text-gray-900"
              }`}
            >
              {latest.systolic}
              <Text className="text-2xl text-neutral">/</Text>
              {latest.diastolic}
            </Text>
            <Text className="text-body text-neutral">mmHg</Text>
          </View>
          {elevated && (
            <View className="mt-2 flex-row items-center gap-1">
              <Icon name="alert-circle" size={16} color="#D97706" />
              <Text className="text-body text-amber-900">{t("bp.highBanner")}</Text>
            </View>
          )}
        </>
      ) : (
        <Text className="mt-2 text-body text-neutral">—</Text>
      )}
    </Card>
  );
};
