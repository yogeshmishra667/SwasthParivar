// Phase 4 §G mobile — Appointment detail + pre-visit report. Shows the
// visit, lets the user mark it complete, and generates the pre-visit PDF
// (POST → poll status → open the signed URL). The report renders
// asynchronously on the server, so we poll `/status` every few seconds
// until ready, then resolve the signed download URL and open it.

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import {
  getAppointment,
  listDoctors,
  completeAppointment,
  generateReport,
  getReportStatus,
  resolveReportDownloadUrl,
  type DoctorAppointmentDto,
} from "@/services/doctor-portal";
import { logError } from "@/services/analytics";
import { appointmentDateTime } from "@/utils/date";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 15; // ~45s

type ReportPhase = "idle" | "generating" | "ready" | "failed";

export default function AppointmentDetailScreen(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeProfile = useActiveProfile();
  const primaryUserId = useProfileStore((s) => s.primaryUserId);
  const targetUserId =
    activeProfile && primaryUserId && activeProfile.id !== primaryUserId
      ? activeProfile.id
      : undefined;

  const [appointment, setAppointment] = useState<DoctorAppointmentDto | null>(null);
  const [doctorName, setDoctorName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  const [reportPhase, setReportPhase] = useState<ReportPhase>("idle");
  const [reportId, setReportId] = useState<string | null>(null);
  const [aiIncluded, setAiIncluded] = useState(false);
  const [opening, setOpening] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [appt, doctors] = await Promise.all([
        getAppointment(id, targetUserId),
        listDoctors(targetUserId),
      ]);
      setAppointment(appt);
      if (appt) setDoctorName(doctors.find((d) => d.id === appt.doctorId)?.name ?? "");
    } catch (e) {
      logError("appointmentDetail.load", e);
    } finally {
      setLoading(false);
    }
  }, [id, targetUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Clear any in-flight poll on unmount.
  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    },
    [],
  );

  const pollStatus = useCallback((rid: string, attempt: number): void => {
    pollRef.current = setTimeout(() => {
      void (async () => {
        try {
          const { status } = await getReportStatus(rid);
          if (status === "ready") {
            setReportPhase("ready");
          } else if (status === "failed") {
            setReportPhase("failed");
          } else if (attempt + 1 >= POLL_MAX_ATTEMPTS) {
            setReportPhase("failed");
          } else {
            pollStatus(rid, attempt + 1);
          }
        } catch (e) {
          logError("appointmentDetail.pollReport", e);
          setReportPhase("failed");
        }
      })();
    }, POLL_INTERVAL_MS);
  }, []);

  const onGenerate = async (): Promise<void> => {
    setReportPhase("generating");
    try {
      const report = await generateReport({ appointmentId: id, targetUserId });
      setReportId(report.id);
      setAiIncluded(report.aiSummaryIncluded);
      if (report.status === "ready") {
        setReportPhase("ready");
      } else {
        pollStatus(report.id, 0);
      }
    } catch (e) {
      logError("appointmentDetail.generateReport", e);
      setReportPhase("failed");
    }
  };

  const onOpen = async (): Promise<void> => {
    if (!reportId) return;
    setOpening(true);
    try {
      const url = await resolveReportDownloadUrl(reportId);
      await Linking.openURL(url);
    } catch (e) {
      logError("appointmentDetail.openReport", e);
    } finally {
      setOpening(false);
    }
  };

  const onComplete = async (): Promise<void> => {
    setCompleting(true);
    try {
      const updated = await completeAppointment(id);
      setAppointment(updated);
    } catch (e) {
      logError("appointmentDetail.complete", e);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ headerShown: true, title: t("doctorPortal.detail.title") }} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 96 }}>
        <ActiveProfileBadge />

        {loading ? (
          <View className="items-center justify-center py-8">
            <Icon name="hourglass-outline" size={28} color="#9CA3AF" />
            <Text className="mt-2 text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.loading")}
            </Text>
          </View>
        ) : appointment === null ? (
          <Card className="items-center py-6">
            <Icon name="cloud-offline-outline" size={32} color="#9CA3AF" />
            <Text className="mt-3 text-center text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.loadFailed")}
            </Text>
          </Card>
        ) : (
          <>
            <Card>
              <View className="flex-row items-start gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                  <Icon name="medkit-outline" size={22} color="#2563EB" />
                </View>
                <View className="flex-1">
                  <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {doctorName}
                  </Text>
                  <Text className="mt-1 text-important text-gray-700 dark:text-gray-300">
                    {appointmentDateTime(appointment.scheduledAt)}
                  </Text>
                </View>
              </View>
              <View className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                <Text className="text-sm text-neutral dark:text-gray-400">
                  {t("doctorPortal.detail.purposeLabel")}
                </Text>
                <Text className="text-important text-gray-900 dark:text-gray-100">
                  {appointment.purpose}
                </Text>
              </View>
            </Card>

            {appointment.status === "scheduled" ? (
              <Button
                label={t("doctorPortal.detail.markComplete")}
                variant="secondary"
                onPress={() => void onComplete()}
                disabled={completing}
              />
            ) : appointment.status === "completed" ? (
              <View className="flex-row items-center gap-2">
                <Icon name="checkmark-circle" size={20} color="#16A34A" />
                <Text className="text-body text-success">
                  {t("doctorPortal.detail.completedNote")}
                </Text>
              </View>
            ) : null}

            {/* Pre-visit report */}
            <Card>
              <Text className="text-important font-bold text-gray-900 dark:text-gray-100">
                {t("doctorPortal.detail.reportSection")}
              </Text>
              <Text className="mt-1 text-body text-neutral dark:text-gray-400">
                {t("doctorPortal.detail.reportHint")}
              </Text>

              <View className="mt-3">
                {reportPhase === "idle" && (
                  <Button
                    label={t("doctorPortal.detail.generate")}
                    onPress={() => void onGenerate()}
                  />
                )}

                {reportPhase === "generating" && (
                  <View className="flex-row items-center gap-2 py-2">
                    <Icon name="hourglass-outline" size={20} color="#2563EB" />
                    <Text className="text-body text-gray-700 dark:text-gray-300">
                      {t("doctorPortal.detail.generating")}
                    </Text>
                  </View>
                )}

                {reportPhase === "ready" && (
                  <View className="gap-2">
                    <View className="flex-row items-center gap-2">
                      <Icon name="document-text" size={20} color="#16A34A" />
                      <Text className="text-body font-semibold text-success">
                        {t("doctorPortal.detail.ready")}
                      </Text>
                    </View>
                    {aiIncluded && (
                      <Text className="text-sm text-neutral dark:text-gray-400">
                        {t("doctorPortal.detail.aiIncluded")}
                      </Text>
                    )}
                    <Button
                      label={t("doctorPortal.detail.open")}
                      onPress={() => void onOpen()}
                      disabled={opening}
                    />
                  </View>
                )}

                {reportPhase === "failed" && (
                  <View className="gap-2">
                    <Text className="text-body text-critical">
                      {t("doctorPortal.detail.failed")}
                    </Text>
                    <Button
                      label={t("common.retry")}
                      variant="secondary"
                      onPress={() => void onGenerate()}
                    />
                  </View>
                )}
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
