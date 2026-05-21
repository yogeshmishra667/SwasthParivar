// Phase 3 Feature C — GuardianHome (phase3.md M.3).
// A guardian's patients, ordered by urgency (sortPatientsByUrgency):
// orange first, then yellow, then safe. Each row is the patient's
// latest alert; tapping an alerting row opens AlertDetail.

import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { sortPatientsByUrgency, type PatientUrgency } from "@swasth/domain-logic";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { AlertCard, type AlertCardSeverity } from "@/components/family/AlertCard";
import { Icon } from "@/components/ui/Icon";
import { listPatientsForGuardian, type PatientLinkSummary } from "@/services/family";
import { listGuardianAlerts, type GuardianAlertDto } from "@/services/silent-guardian";
import { relativeDate } from "@/utils/date";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface PatientRow {
  link: PatientLinkSummary;
  alert: GuardianAlertDto | null;
}

export default function GuardianHomeScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const [patients, alertPage] = await Promise.all([
      listPatientsForGuardian("accepted"),
      listGuardianAlerts({ limit: 50 }),
    ]);

    // Alerts arrive newest-first → the first one seen per patient is
    // their latest.
    const latest = new Map<string, GuardianAlertDto>();
    for (const a of alertPage.data) {
      if (!latest.has(a.patientId)) latest.set(a.patientId, a);
    }

    const urgency: PatientUrgency[] = patients.map((p) => {
      const a = latest.get(p.patient.id);
      return {
        id: p.patient.id,
        latestAlertSeverity: a ? a.severity : "safe",
        alertAgeMin: a
          ? (Date.now() - new Date(a.createdAt).getTime()) / 60_000
          : Number.MAX_SAFE_INTEGER,
      };
    });

    const order = sortPatientsByUrgency({ patients: urgency });
    const byId = new Map(patients.map((p) => [p.patient.id, p]));
    setRows(
      order
        .map((id) => byId.get(id))
        .filter((p): p is PatientLinkSummary => p !== undefined)
        .map((p) => ({ link: p, alert: latest.get(p.patient.id) ?? null })),
    );
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

  const severityLabel = (severity: AlertCardSeverity): string | undefined => {
    if (severity === "orange") return t("guardian.severityOrange");
    if (severity === "yellow") return t("guardian.severityYellow");
    return undefined;
  };

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
          <Text className="text-hero font-bold">{t("guardian.homeTitle")}</Text>
        </View>
        <ActiveProfileBadge />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-body text-neutral">{t("guardian.loading")}</Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Icon name="people-outline" size={48} color="#6B7280" />
          <Text className="mt-3 text-center text-important text-neutral">
            {t("guardian.emptyHome")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.link.linkId}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          renderItem={({ item }) => {
            const severity: AlertCardSeverity = item.alert ? item.alert.severity : "safe";
            return (
              <AlertCard
                severity={severity}
                patientName={item.link.patient.name}
                relationship={item.link.relationship}
                severityLabel={severityLabel(severity)}
                headline={item.alert ? item.alert.title : t("guardian.safeHeadline")}
                body={item.alert ? item.alert.summary : t("guardian.safeBody")}
                timeLabel={item.alert ? relativeDate(item.alert.createdAt, t) : undefined}
                unread={item.alert ? item.alert.readAt === null : false}
                ctaLabel={item.alert ? t("guardian.viewDetail") : undefined}
                onPress={
                  item.alert
                    ? () =>
                        router.push({
                          pathname: "/guardian/alert/[alertId]",
                          params: { alertId: item.alert!.id },
                        })
                    : undefined
                }
              />
            );
          }}
          ListFooterComponent={
            <Pressable
              onPress={() => router.push("/guardian/history")}
              accessibilityRole="button"
              accessibilityLabel={t("guardian.history")}
              style={{ minHeight: TOUCH_TARGET_MIN }}
              className="mt-2 flex-row items-center justify-center gap-1 rounded-2xl border border-gray-300 bg-white"
            >
              <Icon name="time-outline" size={18} color="#2563EB" />
              <Text className="text-important font-semibold text-primary">
                {t("guardian.history")}
              </Text>
            </Pressable>
          }
        />
      )}
    </SafeAreaView>
  );
}
