// Phase 3 Feature C — AlertDetail (phase3.md M.3).
// Opening the screen marks the alert read (markGuardianAlertRead also
// returns the alert, so it doubles as the fetch). Shows the why + the
// suggested action, a jump to the patient dashboard, and a one-tap
// helpful / not-helpful feedback control.

import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import {
  markGuardianAlertRead,
  sendGuardianAlertFeedback,
  type GuardianAlertDto,
} from "@/services/silent-guardian";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function AlertDetailScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { alertId } = useLocalSearchParams<{ alertId: string }>();

  const [alert, setAlert] = useState<GuardianAlertDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackDone, setFeedbackDone] = useState(false);

  // Opening the alert marks it read; the same call returns the row, so
  // it doubles as the fetch. Extracted so the error state can retry it.
  const load = useCallback(async (): Promise<void> => {
    if (!alertId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const row = await markGuardianAlertRead(alertId);
    setAlert(row);
    if (row?.actionTaken) setFeedbackDone(true);
    setLoading(false);
  }, [alertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const giveFeedback = useCallback(
    (helpful: boolean): void => {
      if (!alertId) return;
      setFeedbackDone(true); // optimistic — feedback failure is non-blocking
      void sendGuardianAlertFeedback(alertId, { helpful });
    },
    [alertId],
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between border-b border-gray-200 px-2 py-2">
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t("guardian.back")}
            className="min-h-touch min-w-touch items-center justify-center"
            hitSlop={8}
          >
            <Icon name="chevron-back" size={24} color="#111827" />
          </Pressable>
          <Text className="text-hero font-bold">{t("guardian.detailTitle")}</Text>
        </View>
        <ActiveProfileBadge />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-body text-neutral">{t("guardian.loading")}</Text>
        </View>
      ) : alert === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <Icon name="cloud-offline-outline" size={48} color="#6B7280" />
          <Text className="mt-3 text-center text-important text-neutral">
            {t("guardian.loadError")}
          </Text>
          <View className="mt-4">
            <Button label={t("guardian.retry")} onPress={() => void load()} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View>
            <Text className="text-body font-semibold text-warning">
              {alert.severity === "orange"
                ? t("guardian.severityOrange")
                : t("guardian.severityYellow")}
            </Text>
            <Text className="mt-1 text-hero font-bold text-gray-900">{alert.title}</Text>
          </View>

          <View>
            <Text className="mb-1 text-important font-bold text-gray-900">
              {t("guardian.whatHappened")}
            </Text>
            <Text accessibilityRole="text" className="text-important text-gray-800">
              {alert.explanation}
            </Text>
          </View>

          <View>
            <Text className="mb-1 text-important font-bold text-gray-900">
              {t("guardian.whatToDo")}
            </Text>
            <Text accessibilityRole="text" className="text-important text-gray-800">
              {alert.suggestedAction}
            </Text>
          </View>

          <Button
            label={t("guardian.viewPatient")}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: "/patient/[id]", params: { id: alert.patientId } })
            }
          />

          <View className="rounded-2xl border border-gray-200 bg-white p-4">
            {feedbackDone ? (
              <Text className="text-body text-success">{t("guardian.feedbackThanks")}</Text>
            ) : (
              <>
                <Text className="mb-3 text-important font-semibold text-gray-900">
                  {t("guardian.feedbackQuestion")}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => giveFeedback(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t("guardian.helpful")}
                    style={{ minHeight: TOUCH_TARGET_MIN }}
                    className="flex-1 flex-row items-center justify-center gap-1 rounded-2xl bg-primary px-4"
                  >
                    <Icon name="thumbs-up" size={18} color="#FFFFFF" />
                    <Text className="text-important font-semibold text-white">
                      {t("guardian.helpful")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => giveFeedback(false)}
                    accessibilityRole="button"
                    accessibilityLabel={t("guardian.notHelpful")}
                    style={{ minHeight: TOUCH_TARGET_MIN }}
                    className="flex-1 flex-row items-center justify-center gap-1 rounded-2xl border border-gray-300 px-4"
                  >
                    <Icon name="thumbs-down" size={18} color="#6B7280" />
                    <Text className="text-important font-semibold text-gray-900">
                      {t("guardian.notHelpful")}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
