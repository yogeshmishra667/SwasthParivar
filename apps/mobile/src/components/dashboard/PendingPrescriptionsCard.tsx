// Phase 4 §F — dashboard nudge for prescriptions awaiting approval.
// Wrong-med safety depends on the guardian actually approving; a quiet
// pending prescription is exactly what this surfaces. Renders nothing
// when there's nothing pending. Tapping opens the newest pending
// prescription's detail (where approve/reject lives) — there's no list
// screen, and the newest is the most likely one to act on.

import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { PrescriptionListItem } from "@/services/prescriptions";

interface Props {
  pending: readonly PrescriptionListItem[];
  onPress: (prescriptionId: string) => void;
}

export const PendingPrescriptionsCard = ({ pending, onPress }: Props): JSX.Element | null => {
  const { t } = useTranslation();
  if (pending.length === 0) return null;
  // Newest-first from the server; act on the most recent.
  const newest = pending[0];
  if (!newest) return null;

  return (
    <Pressable
      onPress={() => onPress(newest.id)}
      accessibilityRole="button"
      accessibilityLabel={t("prescriptions.dashboard.pendingTitle", { count: pending.length })}
      className="min-h-touch active:opacity-80"
    >
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-white dark:bg-amber-900/60">
            <Icon name="document-text-outline" size={24} color="#D97706" />
          </View>
          <View className="flex-1">
            <Text className="text-important font-semibold text-amber-900 dark:text-amber-200">
              {t("prescriptions.dashboard.pendingTitle", { count: pending.length })}
            </Text>
            <Text className="text-body text-amber-800/80 dark:text-amber-200/70">
              {t("prescriptions.dashboard.tapToReview")}
            </Text>
          </View>
          <Icon name="chevron-forward" size={20} color="#D97706" />
        </View>
      </Card>
    </Pressable>
  );
};
