import { useState } from "react";
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

/**
 * Add-household-profile modal.
 *
 * Posts to `POST /api/v1/household/profiles` and returns the created
 * row to the caller via `onSuccess`. The caller is responsible for
 * splicing the profile into the local store + switching active profile.
 *
 * Phase 1 only allows the diabetes condition (per CLAUDE.md). The
 * endpoint accepts the wider Condition enum so future phases just
 * unhide options here.
 */

interface CreatedProfile {
  id: string;
  name: string;
  age: number;
  conditions: string[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: (profile: CreatedProfile) => void;
}

const PHASE_1_CONDITIONS = ["diabetes"] as const;

export const AddProfileModal = ({ visible, onClose, onSuccess }: Props): JSX.Element => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [conditions, setConditions] = useState<string[]>(["diabetes"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setName("");
    setAge("");
    setConditions(["diabetes"]);
    setError(null);
    setSaving(false);
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const ageNum = Number(age);
  const canSave =
    name.trim().length > 0 &&
    Number.isInteger(ageNum) &&
    ageNum > 0 &&
    ageNum <= 120 &&
    conditions.length > 0 &&
    !saving;

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ success: boolean; data: CreatedProfile }>(
        "/household/profiles",
        {
          name: name.trim(),
          age: ageNum,
          conditions,
        },
      );
      reset();
      onSuccess(res.data);
    } catch (err) {
      logError("AddProfileModal.submit", err);
      setError(t("settings.addProfileFailed", { defaultValue: t("auth.errorRetry") }));
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
          <View className="w-full rounded-t-3xl bg-white p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-hero font-bold">
                {t("settings.addProfile", { defaultValue: "Add another profile" })}
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
              <Text className="mb-1 text-body">{t("onboarding.namePlaceholder")}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("onboarding.namePlaceholder")}
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
                accessibilityLabel={t("onboarding.namePlaceholder")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="mb-3 rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-body text-gray-900"
              />

              <Text className="mb-1 text-body">{t("onboarding.agePlaceholder")}</Text>
              <TextInput
                value={age}
                onChangeText={(v) => setAge(v.replace(/[^0-9]/g, ""))}
                placeholder={t("onboarding.agePlaceholder")}
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel={t("onboarding.agePlaceholder")}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className="mb-3 rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-body text-gray-900"
              />

              <Text className="mb-1 text-body">{t("onboarding.selectCondition")}</Text>
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
                        selected ? "border-primary bg-blue-50" : "border-gray-300"
                      }`}
                    >
                      <Text
                        className={`text-important ${
                          selected ? "font-semibold text-primary" : "text-neutral"
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
