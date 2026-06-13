// Phase 4 §G mobile — Appointments list. Upcoming visits ordered by
// date (server returns upcoming-first), each row tappable into the
// detail/report screen. Active-profile aware: when the household primary
// operates a sub-profile, `targetUserId` scopes the list (same pattern as
// emergency-contacts).
//
// The `doctor_portal_enabled` kill-switch is server-side: a disabled
// portal returns 503, which we surface as the "not available yet" state
// rather than an error.

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import type { AxiosError } from "axios";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { listAppointments, listDoctors, type DoctorAppointmentDto } from "@/services/doctor-portal";
import { logError } from "@/services/analytics";
import { appointmentDateTime } from "@/utils/date";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

const STATUS_COLOR: Record<DoctorAppointmentDto["status"], string> = {
  scheduled: "#2563EB",
  completed: "#16A34A",
  cancelled: "#6B7280",
  missed: "#D97706",
};

export default function AppointmentsListScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const activeProfile = useActiveProfile();
  const primaryUserId = useProfileStore((s) => s.primaryUserId);

  const targetUserId =
    activeProfile && primaryUserId && activeProfile.id !== primaryUserId
      ? activeProfile.id
      : undefined;

  const [appointments, setAppointments] = useState<readonly DoctorAppointmentDto[]>([]);
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<"ok" | "error" | "disabled">("ok");

  const load = useCallback(async (): Promise<void> => {
    setState("ok");
    try {
      const [appts, doctors] = await Promise.all([
        listAppointments(targetUserId !== undefined ? { targetUserId } : undefined),
        listDoctors(targetUserId),
      ]);
      setAppointments(appts);
      setDoctorNames(Object.fromEntries(doctors.map((d) => [d.id, d.name])));
    } catch (e) {
      const code = (e as AxiosError<{ error?: { code?: string } }>).response?.data?.error?.code;
      if (code === "DOCTOR_PORTAL_DISABLED") {
        setState("disabled");
      } else {
        logError("appointments.load", e);
        setState("error");
      }
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  // Reload on focus so a freshly-created appointment shows on back-nav.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ headerShown: true, title: t("doctorPortal.title") }} />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        <ActiveProfileBadge />

        {loading ? (
          <View className="items-center justify-center py-8">
            <Icon name="hourglass-outline" size={28} color="#9CA3AF" />
            <Text className="mt-2 text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.loading")}
            </Text>
          </View>
        ) : state === "disabled" ? (
          <Card className="items-center py-8">
            <Icon name="time-outline" size={32} color="#9CA3AF" />
            <Text className="mt-3 text-center text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.disabled")}
            </Text>
          </Card>
        ) : state === "error" ? (
          <Card className="items-center py-6">
            <Icon name="cloud-offline-outline" size={32} color="#9CA3AF" />
            <Text className="mt-3 text-center text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.loadFailed")}
            </Text>
            <View className="mt-3">
              <Button label={t("common.retry")} variant="secondary" onPress={() => void load()} />
            </View>
          </Card>
        ) : appointments.length === 0 ? (
          <Card className="items-center py-8">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
              <Icon name="calendar-outline" size={26} color="#9CA3AF" />
            </View>
            <Text className="mt-3 text-center text-important font-semibold text-gray-900 dark:text-gray-100">
              {t("doctorPortal.list.emptyTitle")}
            </Text>
            <Text className="mt-1 px-6 text-center text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.list.emptyBody")}
            </Text>
          </Card>
        ) : (
          appointments.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => router.push(`/appointments/${a.id}`)}
              accessibilityRole="button"
              style={{ minHeight: TOUCH_TARGET_MIN }}
            >
              <Card>
                <View className="flex-row items-start gap-3">
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                    <Icon name="medkit-outline" size={22} color="#2563EB" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                      {doctorNames[a.doctorId] ?? t("doctorPortal.detail.title")}
                    </Text>
                    <Text className="mt-0.5 text-body text-gray-700 dark:text-gray-300">
                      {appointmentDateTime(a.scheduledAt)}
                    </Text>
                    <Text className="text-sm text-neutral dark:text-gray-400">{a.purpose}</Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: STATUS_COLOR[a.status] }}
                    >
                      {t(`doctorPortal.status.${a.status}`)}
                    </Text>
                    <Icon name="chevron-forward" size={18} color="#9CA3AF" />
                  </View>
                </View>
              </Card>
            </Pressable>
          ))
        )}

        {state === "ok" && !loading && (
          <>
            <View className="mt-2">
              <Button
                label={`+ ${t("doctorPortal.list.add")}`}
                onPress={() => router.push("/appointments/new")}
              />
            </View>
            <Text className="mt-1 px-2 text-center text-sm text-neutral dark:text-gray-500">
              {t("doctorPortal.list.reminderNote")}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
