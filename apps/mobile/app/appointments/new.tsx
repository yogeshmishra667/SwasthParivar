// Phase 4 §G mobile — New Appointment. Tap-only throughout (no date
// picker dependency, no typing for date/time): a day stepper + three
// time-of-day chips keep it within the elderly-UX rules. Doctors are
// picked from the patient's saved list; "+ add doctor" opens an inline
// create modal.

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { DoctorFormModal } from "@/components/appointments/DoctorFormModal";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import { listDoctors, createAppointment, type DoctorProfileDto } from "@/services/doctor-portal";
import { logError } from "@/services/analytics";
import { appointmentDateTime } from "@/utils/date";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

const MAX_DAYS_AHEAD = 90;
const TIME_PRESETS = [
  { key: "timeMorning", hour: 9 },
  { key: "timeAfternoon", hour: 14 },
  { key: "timeEvening", hour: 18 },
] as const;

const buildScheduledAt = (dayOffset: number, hour: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

export default function NewAppointmentScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const activeProfile = useActiveProfile();
  const primaryUserId = useProfileStore((s) => s.primaryUserId);
  const targetUserId =
    activeProfile && primaryUserId && activeProfile.id !== primaryUserId
      ? activeProfile.id
      : undefined;

  const [doctors, setDoctors] = useState<readonly DoctorProfileDto[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(1); // default tomorrow
  const [hour, setHour] = useState(9);
  const [purpose, setPurpose] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDoctors = useCallback(async (): Promise<void> => {
    try {
      const list = await listDoctors(targetUserId);
      setDoctors(list);
      // Auto-select when there's exactly one — one less tap.
      if (list.length === 1 && list[0]) setSelectedDoctorId(list[0].id);
    } catch (e) {
      logError("appointments.loadDoctors", e);
    }
  }, [targetUserId]);

  useEffect(() => {
    void loadDoctors();
  }, [loadDoctors]);

  const onDoctorCreated = (doctor: DoctorProfileDto): void => {
    setDoctors((prev) => [doctor, ...prev]);
    setSelectedDoctorId(doctor.id);
    setModalOpen(false);
  };

  const scheduledAt = buildScheduledAt(dayOffset, hour);

  const submit = async (): Promise<void> => {
    if (!selectedDoctorId) {
      setError(t("doctorPortal.new.missingDoctor"));
      return;
    }
    if (purpose.trim().length === 0) {
      setError(t("doctorPortal.new.missingPurpose"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createAppointment({
        doctorId: selectedDoctorId,
        scheduledAt: scheduledAt.toISOString(),
        purpose: purpose.trim(),
        targetUserId,
      });
      router.back();
    } catch (e) {
      logError("appointments.create", e);
      setError(t("doctorPortal.new.saveFailed"));
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ headerShown: true, title: t("doctorPortal.new.title") }} />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
      >
        <ActiveProfileBadge />

        {/* Doctor */}
        <View>
          <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("doctorPortal.new.doctorSection")}
          </Text>
          {doctors.length === 0 ? (
            <Text className="mb-2 text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.new.noDoctors")}
            </Text>
          ) : (
            <View className="gap-2">
              {doctors.map((d) => {
                const selected = d.id === selectedDoctorId;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => setSelectedDoctorId(d.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={{ minHeight: TOUCH_TARGET_MIN }}
                    className={`flex-row items-center gap-3 rounded-2xl border p-3 ${
                      selected
                        ? "border-primary bg-blue-50 dark:bg-blue-900/30"
                        : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                  >
                    <Icon
                      name={selected ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={selected ? "#2563EB" : "#9CA3AF"}
                    />
                    <View className="flex-1">
                      <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                        {d.name}
                      </Text>
                      <Text className="text-sm text-neutral dark:text-gray-400">{d.specialty}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          <View className="mt-2">
            <Button
              label={`+ ${t("doctorPortal.new.addDoctor")}`}
              variant="ghost"
              onPress={() => setModalOpen(true)}
            />
          </View>
        </View>

        {/* Date */}
        <View>
          <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("doctorPortal.new.dateSection")}
          </Text>
          <Card>
            <View className="flex-row items-center justify-between">
              <StepperButton
                icon="chevron-back"
                disabled={dayOffset <= 0}
                onPress={() => setDayOffset((v) => Math.max(0, v - 1))}
                accessibilityLabel={t("common.back")}
              />
              <Text className="flex-1 text-center text-important font-semibold text-gray-900 dark:text-gray-100">
                {appointmentDateTime(scheduledAt.toISOString())}
              </Text>
              <StepperButton
                icon="chevron-forward"
                disabled={dayOffset >= MAX_DAYS_AHEAD}
                onPress={() => setDayOffset((v) => Math.min(MAX_DAYS_AHEAD, v + 1))}
                accessibilityLabel={t("doctorPortal.list.add")}
              />
            </View>
          </Card>
        </View>

        {/* Time */}
        <View>
          <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("doctorPortal.new.timeSection")}
          </Text>
          <View className="flex-row gap-2">
            {TIME_PRESETS.map((preset) => {
              const selected = hour === preset.hour;
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => setHour(preset.hour)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{ minHeight: TOUCH_TARGET_MIN }}
                  className={`flex-1 items-center justify-center rounded-2xl border p-3 ${
                    selected
                      ? "border-primary bg-blue-50 dark:bg-blue-900/30"
                      : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                  }`}
                >
                  <Text
                    className={`text-body font-semibold ${
                      selected ? "text-primary" : "text-gray-700 dark:text-gray-200"
                    }`}
                  >
                    {t(`doctorPortal.new.${preset.key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Purpose */}
        <View>
          <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("doctorPortal.new.purposeSection")}
          </Text>
          <TextInput
            value={purpose}
            onChangeText={setPurpose}
            placeholder={t("doctorPortal.new.purposePlaceholder")}
            placeholderTextColor="#9CA3AF"
            style={{ minHeight: TOUCH_TARGET_MIN }}
            className="rounded-xl border border-gray-300 px-4 text-important text-gray-900 dark:border-gray-700 dark:text-gray-100"
          />
        </View>

        {error !== null && <Text className="text-body font-medium text-critical">{error}</Text>}

        <Button
          label={t("doctorPortal.new.save")}
          onPress={() => void submit()}
          disabled={saving}
        />
      </ScrollView>

      <DoctorFormModal
        visible={modalOpen}
        targetUserId={targetUserId}
        onClose={() => setModalOpen(false)}
        onCreated={onDoctorCreated}
      />
    </SafeAreaView>
  );
}

interface StepperProps {
  icon: "chevron-back" | "chevron-forward";
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

const StepperButton = ({
  icon,
  disabled,
  onPress,
  accessibilityLabel,
}: StepperProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
    className={`items-center justify-center rounded-xl border px-3 ${
      disabled
        ? "border-gray-200 opacity-40 dark:border-gray-800"
        : "border-gray-300 dark:border-gray-700"
    }`}
  >
    <Icon name={icon} size={22} color="#6B7280" />
  </Pressable>
);
