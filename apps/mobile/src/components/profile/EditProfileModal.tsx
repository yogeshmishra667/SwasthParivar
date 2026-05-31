import { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import type { Profile } from "@/stores/profile.store";

interface Props {
  visible: boolean;
  profile: Profile | null;
  isPrimary: boolean;
  onClose: () => void;
  onSuccess: (updatedProfile: Profile) => void;
}

const PHASE_1_CONDITIONS = ["diabetes"] as const;

export const EditProfileModal = ({
  visible,
  profile,
  isPrimary,
  onClose,
  onSuccess,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setAge(profile.age?.toString() ?? "");
      setConditions(profile.conditions ?? []);
    }
  }, [profile]);

  if (!profile) return null;

  const handleClose = (): void => {
    onClose();
  };

  const ageNum = Number(age);
  const canSave =
    name.trim().length > 0 &&
    (!age || (Number.isInteger(ageNum) && ageNum > 0 && ageNum <= 120)) &&
    conditions.length > 0 &&
    !saving;

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        ...(age ? { age: ageNum } : {}),
        conditions,
      };

      const url = isPrimary ? "/users/me" : `/household/profiles/${profile.id}`;
      const res = await api.patch<{
        success: boolean;
        data: { name: string; age: number; conditions: string[] };
      }>(url, payload);

      onSuccess({
        ...profile,
        name: res.data.name,
        age: res.data.age,
        conditions: res.data.conditions,
      });
    } catch (err) {
      logError("EditProfileModal.submit", err);
      setError(
        t("settings.editProfileFailed", {
          defaultValue: "Failed to update profile. Please try again.",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        style={{ flex: 1 }}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="w-full rounded-t-3xl bg-white dark:bg-gray-900 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
                {t("settings.editProfile", { defaultValue: "Edit Profile" })}
              </Text>
              <Pressable
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
                style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
                className="items-center justify-center"
              >
                <Icon name="close" size={24} color="#6B7280" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("onboarding.namePlaceholder")}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("onboarding.namePlaceholder")}
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
                accessibilityLabel={t("onboarding.namePlaceholder")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="mb-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-body text-gray-900 dark:text-gray-100"
              />

              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("onboarding.agePlaceholder")}
              </Text>
              <TextInput
                value={age}
                onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
                placeholder={t("onboarding.agePlaceholder")}
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel={t("onboarding.agePlaceholder")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="mb-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-3 text-body text-gray-900 dark:text-gray-100"
              />

              <Text className="mb-1 text-body text-neutral dark:text-gray-400">
                {t("onboarding.selectCondition")}
              </Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {PHASE_1_CONDITIONS.map((c) => {
                  const selected = conditions.includes(c);
                  return (
                    <Pressable
                      key={c}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        setConditions((prev) =>
                          selected ? prev.filter((x) => x !== c) : [...prev, c],
                        );
                      }}
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
                            ? "font-semibold text-primary"
                            : "text-neutral dark:text-gray-400"
                        }`}
                      >
                        {t(`onboarding.${c}`, { defaultValue: c })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {error !== null && <Text className="mb-2 text-body text-warning">{error}</Text>}
            </ScrollView>

            <View className="mt-2 flex-row gap-2">
              <View className="flex-1">
                <Button label={t("common.cancel")} variant="ghost" onPress={handleClose} />
              </View>
              <View className="flex-1">
                <Button
                  label={t("common.save")}
                  onPress={() => void submit()}
                  disabled={!canSave}
                />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
