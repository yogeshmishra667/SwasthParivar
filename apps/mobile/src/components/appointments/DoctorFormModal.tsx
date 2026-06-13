// Phase 4 §G mobile — add-a-doctor modal used by the New Appointment
// screen. Create-only (Phase 4 has no doctor edit/delete on mobile).
// Phone validation mirrors the server's E.164 shape so a malformed
// number is caught before the round-trip.

import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { logError } from "@/services/analytics";
import { createDoctor, type DoctorProfileDto } from "@/services/doctor-portal";

const PHONE_E164 = /^\+[1-9]\d{9,14}$/;

interface Props {
  visible: boolean;
  targetUserId: string | undefined;
  onClose: () => void;
  onCreated: (doctor: DoctorProfileDto) => void;
}

export const DoctorFormModal = ({
  visible,
  targetUserId,
  onClose,
  onCreated,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [clinic, setClinic] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setSpecialty("");
    setClinic("");
    setPhone("");
    setError(null);
    setSaving(false);
  }, [visible]);

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim();
    const trimmedSpecialty = specialty.trim();
    if (trimmedName.length === 0) {
      setError(t("doctorPortal.doctorForm.missingName"));
      return;
    }
    if (trimmedSpecialty.length === 0) {
      setError(t("doctorPortal.doctorForm.missingSpecialty"));
      return;
    }
    const trimmedPhone = phone.trim();
    if (trimmedPhone.length > 0 && !PHONE_E164.test(trimmedPhone)) {
      setError(t("doctorPortal.doctorForm.invalidPhone"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const doctor = await createDoctor({
        name: trimmedName,
        specialty: trimmedSpecialty,
        clinicName: clinic.trim().length > 0 ? clinic.trim() : undefined,
        phone: trimmedPhone.length > 0 ? trimmedPhone : undefined,
        targetUserId,
      });
      onCreated(doctor);
    } catch (e) {
      logError("doctorPortal.createDoctor", e);
      setError(t("doctorPortal.new.saveFailed"));
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="rounded-t-3xl bg-white p-5 dark:bg-gray-900">
          <Text className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("doctorPortal.doctorForm.title")}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Field
              label={t("doctorPortal.doctorForm.name")}
              value={name}
              onChangeText={setName}
              placeholder={t("doctorPortal.doctorForm.namePlaceholder")}
            />
            <Field
              label={t("doctorPortal.doctorForm.specialty")}
              value={specialty}
              onChangeText={setSpecialty}
              placeholder={t("doctorPortal.doctorForm.specialtyPlaceholder")}
            />
            <Field
              label={t("doctorPortal.doctorForm.clinic")}
              value={clinic}
              onChangeText={setClinic}
            />
            <Field
              label={t("doctorPortal.doctorForm.phone")}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+9198…"
            />

            {error !== null && (
              <Text className="mb-3 text-body font-medium text-critical">{error}</Text>
            )}

            <View className="mt-2 gap-2">
              <Button
                label={t("doctorPortal.doctorForm.save")}
                onPress={() => void submit()}
                disabled={saving}
              />
              <Button label={t("common.cancel")} variant="ghost" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad";
}

const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
}: FieldProps): JSX.Element => (
  <View className="mb-4">
    <Text className="mb-1 text-body font-medium text-gray-700 dark:text-gray-300">{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      keyboardType={keyboardType}
      style={{ minHeight: TOUCH_TARGET_MIN }}
      className="rounded-xl border border-gray-300 px-4 text-important text-gray-900 dark:border-gray-700 dark:text-gray-100"
    />
  </View>
);
