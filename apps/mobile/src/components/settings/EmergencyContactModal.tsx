import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import type { EmergencyContactDto } from "@/services/emergency-contacts";

// Add OR edit modal — same form, two modes. The screen passes
// `existing` when editing; null/undefined means "creating new".
//
// E.164 validation here is the same shape the server enforces
// (`^\+[1-9]\d{9,14}$`), so a malformed phone is rejected before the
// network round-trip — quicker error feedback for the user.

const PHONE_E164 = /^\+[1-9]\d{9,14}$/;

const RELATIONSHIP_OPTIONS = ["spouse", "child", "parent", "sibling", "friend", "doctor"] as const;
type RelationshipKey = (typeof RELATIONSHIP_OPTIONS)[number];

interface Props {
  visible: boolean;
  existing: EmergencyContactDto | null;
  /** Default priority assigned when creating a new contact (next free slot). */
  nextPriority: number;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    phone: string;
    relationship: string;
    priority: number;
    isGuardian: boolean;
  }) => Promise<void>;
}

export const EmergencyContactModal = ({
  visible,
  existing,
  nextPriority,
  onClose,
  onSubmit,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<string>("child");
  const [isGuardian, setIsGuardian] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the modal opens — either to the existing
  // row's values (edit) or to empty defaults (create).
  useEffect(() => {
    if (!visible) return;
    if (existing) {
      setName(existing.name);
      setPhone(existing.phone);
      setRelationship(existing.relationship);
      setIsGuardian(existing.isGuardian);
    } else {
      setName("");
      setPhone("+91");
      setRelationship("child");
      setIsGuardian(false);
    }
    setError(null);
    setSaving(false);
  }, [visible, existing]);

  const valid =
    name.trim().length > 0 &&
    PHONE_E164.test(phone.trim()) &&
    relationship.trim().length > 0 &&
    !saving;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim(),
        relationship: relationship.trim(),
        priority: existing?.priority ?? nextPriority,
        isGuardian,
      });
      onClose();
    } catch {
      setError(
        t("emergencyContacts.saveFailed", {
          defaultValue: "Save nahi ho paya. Phir try karein.",
        }),
      );
      setSaving(false);
    }
  };

  const phoneIsTouched = phone !== "+91" && phone.length > 0;
  const phoneError = phoneIsTouched && !PHONE_E164.test(phone.trim());

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        style={{ flex: 1 }}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="w-full rounded-t-3xl bg-white p-6 dark:bg-gray-900">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
                {existing
                  ? t("emergencyContacts.editTitle", { defaultValue: "Contact edit karein" })
                  : t("emergencyContacts.addTitle", { defaultValue: "Naya contact add karein" })}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
                style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
                className="items-center justify-center"
              >
                <Icon name="close" size={24} color="#9CA3AF" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("emergencyContacts.nameLabel", { defaultValue: "Naam" })}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("emergencyContacts.namePlaceholder", {
                  defaultValue: "Jaise: Suresh ji",
                })}
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
                accessibilityLabel={t("emergencyContacts.nameLabel")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="mb-3 rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-body text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />

              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("emergencyContacts.phoneLabel", { defaultValue: "Phone (+91…)" })}
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+919812345678"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                autoCorrect={false}
                accessibilityLabel={t("emergencyContacts.phoneLabel")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className={`mb-1 rounded-xl border bg-gray-50 px-3 py-3 text-body text-gray-900 dark:bg-gray-800 dark:text-gray-100 ${
                  phoneError ? "border-critical" : "border-gray-300 dark:border-gray-700"
                }`}
              />
              {phoneError && (
                <Text className="mb-2 text-sm text-critical">
                  {t("emergencyContacts.phoneInvalid", {
                    defaultValue: "Sahi phone number daalein (+91…)",
                  })}
                </Text>
              )}
              <View className="mb-3" />

              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("emergencyContacts.relationshipLabel", { defaultValue: "Rishta" })}
              </Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {RELATIONSHIP_OPTIONS.map((r: RelationshipKey) => {
                  const selected = relationship === r;
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setRelationship(r)}
                      style={{ minHeight: TOUCH_TARGET_MIN }}
                      className={`rounded-full border px-4 py-2 ${
                        selected
                          ? "border-primary bg-blue-50 dark:bg-blue-950/40"
                          : "border-gray-300 dark:border-gray-700"
                      }`}
                    >
                      <Text
                        className={`text-important ${
                          selected
                            ? "font-semibold text-primary dark:text-blue-400"
                            : "text-neutral dark:text-gray-400"
                        }`}
                      >
                        {t(`emergencyContacts.relationship.${r}`, { defaultValue: r })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View
                className="mb-4 flex-row items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800"
                style={{ minHeight: TOUCH_TARGET_MIN }}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                    {t("emergencyContacts.isGuardianLabel", {
                      defaultValue: "Guardian hai?",
                    })}
                  </Text>
                  <Text className="mt-0.5 text-sm text-neutral dark:text-gray-400">
                    {t("emergencyContacts.isGuardianHint", {
                      defaultValue: "Guardians ko critical alerts bheji jaayengi.",
                    })}
                  </Text>
                </View>
                <Switch
                  value={isGuardian}
                  onValueChange={setIsGuardian}
                  trackColor={{ false: "#D1D5DB", true: "#93C5FD" }}
                  thumbColor={isGuardian ? "#2563EB" : "#F3F4F6"}
                />
              </View>

              {error !== null && <Text className="mb-2 text-body text-warning">{error}</Text>}
            </ScrollView>

            <View className="mt-2 flex-row gap-2">
              <View className="flex-1">
                <Button label={t("common.cancel")} variant="ghost" onPress={onClose} />
              </View>
              <View className="flex-1">
                <Button label={t("common.save")} onPress={() => void submit()} disabled={!valid} />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
