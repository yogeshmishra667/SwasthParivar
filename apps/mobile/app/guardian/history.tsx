// Phase 3 Feature C — AlertHistory (phase3.md M.3).
// The full, cursor-paginated list of a guardian's alerts across all
// patients. A patient-name map is fetched once so each row is named.

import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { AlertCard } from "@/components/family/AlertCard";
import { Icon } from "@/components/ui/Icon";
import { listPatientsForGuardian } from "@/services/family";
import { listGuardianAlerts, type GuardianAlertDto } from "@/services/silent-guardian";
import { relativeDate } from "@/utils/date";

export default function AlertHistoryScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [alerts, setAlerts] = useState<GuardianAlertDto[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // First page + the patient-name map. Re-run on pull-to-refresh.
  const load = useCallback(async (): Promise<void> => {
    const [patients, page] = await Promise.all([
      listPatientsForGuardian("accepted"),
      listGuardianAlerts({ limit: 20 }),
    ]);
    setNames(new Map(patients.map((p) => [p.patient.id, p.patient.name])));
    setAlerts(page.data);
    setCursor(page.cursor);
    setHasMore(page.hasMore);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadMore = useCallback((): void => {
    if (!hasMore || cursor === null || loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      const page = await listGuardianAlerts({ limit: 20, cursor });
      setAlerts((prev) => [...prev, ...page.data]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      setLoadingMore(false);
    })();
  }, [hasMore, cursor, loadingMore]);

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
          <Text className="text-hero font-bold">{t("guardian.historyTitle")}</Text>
        </View>
        <ActiveProfileBadge />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-body text-neutral">{t("guardian.loading")}</Text>
        </View>
      ) : alerts.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Icon name="time-outline" size={48} color="#6B7280" />
          <Text className="mt-3 text-center text-important text-neutral">
            {t("guardian.emptyHistory")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          renderItem={({ item }) => (
            <AlertCard
              severity={item.severity}
              patientName={names.get(item.patientId) ?? "—"}
              severityLabel={
                item.severity === "orange"
                  ? t("guardian.severityOrange")
                  : t("guardian.severityYellow")
              }
              headline={item.title}
              body={item.summary}
              timeLabel={relativeDate(item.createdAt, t)}
              unread={item.readAt === null}
              ctaLabel={t("guardian.viewDetail")}
              onPress={() =>
                router.push({
                  pathname: "/guardian/alert/[alertId]",
                  params: { alertId: item.id },
                })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
