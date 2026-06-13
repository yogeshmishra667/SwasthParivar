// Phase 4 §G — dashboard card surfacing the patient's next upcoming
// doctor visit. Renders nothing when there's no scheduled appointment
// (or the portal is disabled) so it never adds empty chrome to the
// glucose-centric dashboard. Tappable into the appointment detail.

import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { appointmentDateTime } from "@/utils/date";
import type { DoctorAppointmentDto } from "@/services/doctor-portal";

interface Props {
  appointment: DoctorAppointmentDto | null;
  doctorName: string;
  onPress: () => void;
}

export const NextAppointmentCard = ({
  appointment,
  doctorName,
  onPress,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();
  if (!appointment) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("doctorPortal.dashboard.nextVisit", { defaultValue: "Next visit" })}
      className="min-h-touch active:opacity-80"
    >
      <Card>
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
            <Icon name="medkit-outline" size={24} color="#2563EB" />
          </View>
          <View className="flex-1">
            <Text className="text-body text-neutral dark:text-gray-400">
              {t("doctorPortal.dashboard.nextVisit", { defaultValue: "Next visit" })}
            </Text>
            <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
              {doctorName || appointment.purpose}
            </Text>
            <Text className="text-body text-gray-700 dark:text-gray-300">
              {appointmentDateTime(appointment.scheduledAt)}
            </Text>
          </View>
          <Icon name="chevron-forward" size={20} color="#6B7280" />
        </View>
      </Card>
    </Pressable>
  );
};
