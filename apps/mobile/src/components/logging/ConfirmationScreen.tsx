import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { isCriticalGlucose } from "@swasth/shared-types";
import type { GlucoseReadingType } from "@swasth/shared-types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useProfileStore, isRecentSwitch } from "@/stores/profile.store";
import { useActiveProfile } from "@/hooks/useActiveProfile";

interface ConfirmationProps {
  value: number;
  type: GlucoseReadingType;
  uncertainType: boolean;
  onConfirm: (type: GlucoseReadingType) => void;
  onEdit: () => void;
}

const TYPE_OPTIONS: readonly GlucoseReadingType[] = ["fasting", "post_meal", "random"] as const;

const TYPE_LABELS: Record<GlucoseReadingType, string> = {
  fasting: "Fasting",
  pre_meal: "Khane se pehle",
  post_meal: "Post-meal",
  random: "Random",
  bedtime: "Sone se pehle",
};

const EXTREME_CONFIRM_DELAY_MS = 3000;

export const ConfirmationScreen = ({
  value,
  type,
  uncertainType,
  onConfirm,
  onEdit,
}: ConfirmationProps): JSX.Element => {
  const profile = useActiveProfile();
  const [selectedType, setSelectedType] = useState<GlucoseReadingType>(type);
  const recentSwitch = useProfileStore(isRecentSwitch);
  const isCritical = isCriticalGlucose(value);
  const [confirmReady, setConfirmReady] = useState(!isCritical);

  useEffect(() => {
    if (!isCritical) return;
    const id = setTimeout(() => setConfirmReady(true), EXTREME_CONFIRM_DELAY_MS);
    return () => clearTimeout(id);
  }, [isCritical]);

  return (
    <View className="gap-4 p-4">
      <Card>
        <View className="flex-row items-center gap-2">
          <Icon name="person" size={16} color="#374151" />
          <Text className="text-important font-semibold">
            {profile?.name ?? "—"} ji ke liye save ho raha hai
          </Text>
        </View>
        {recentSwitch && (
          <Text className="mt-1 text-body text-warning">
            Abhi-abhi profile switch kiya — sahi profile hai na?
          </Text>
        )}
      </Card>

      <Card>
        <Text className="text-hero font-bold">{value}</Text>
        <Text className="text-body text-neutral">mg/dL</Text>
        {isCritical && (
          <View className="mt-2 flex-row items-center gap-2">
            <Icon name="warning" size={20} color="#DC2626" />
            <Text className="text-important font-bold text-critical">
              Yeh bahut {value > 315 ? "zyada" : "kam"} hai. Kya sahi hai?
            </Text>
          </View>
        )}
      </Card>

      <Card>
        <Text className="mb-2 text-body text-neutral">
          {uncertainType ? "Fasting ya post-meal? Tap karein:" : "Type:"}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <Button
              key={opt}
              label={TYPE_LABELS[opt] ?? opt}
              variant={selectedType === opt ? "primary" : "ghost"}
              onPress={() => setSelectedType(opt)}
            />
          ))}
        </View>
      </Card>

      <View className="flex-row gap-3">
        <Button label="Edit" variant="ghost" onPress={onEdit} />
        <Button
          label={confirmReady ? "Haan, save" : "Wait..."}
          variant={isCritical ? "critical" : "primary"}
          disabled={!confirmReady}
          onPress={() => onConfirm(selectedType)}
        />
      </View>
    </View>
  );
};
