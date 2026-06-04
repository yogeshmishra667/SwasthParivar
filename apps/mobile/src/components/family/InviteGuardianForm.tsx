// Phase 2 — Invite a guardian form. Phone-first (guardian must already
// have an account; the server returns FAMILY_INVITE_INVALID otherwise
// and we surface a friendly "ask them to install first" copy).

import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { inviteGuardian, type AlertSensitivity } from "@/services/family";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { normalizeIndianPhone } from "@/utils/phone";
import { getFirstName } from "@/utils/getFirstName";

interface InviteGuardianFormProps {
  onSent: () => void;
}

interface SensitivityOption {
  value: AlertSensitivity;
  color: string;
  dot: string;
}

const SENSITIVITIES: readonly SensitivityOption[] = [
  { value: "low", color: "#16A34A", dot: "bg-green-500" },
  { value: "medium", color: "#2563EB", dot: "bg-blue-500" },
  { value: "high", color: "#DC2626", dot: "bg-red-500" },
] as const;

export const InviteGuardianForm = ({ onSent }: InviteGuardianFormProps): JSX.Element => {
  const { t } = useTranslation();
  const activeProfile = useActiveProfile();
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [sensitivity, setSensitivity] = useState<AlertSensitivity>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) {
      setError(t("family.inviteFailed"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await inviteGuardian({
      guardianPhone: normalized,
      // The invite is for whichever profile is active on this shared
      // device — not always the primary account.
      ...(activeProfile ? { targetUserId: activeProfile.id } : {}),
      ...(relationship.trim().length > 0 ? { relationship: relationship.trim() } : {}),
      visibleConditions: ["diabetes"],
      alertEnabled,
      alertSensitivity: sensitivity,
    });
    setSubmitting(false);
    if (res.kind === "ok") {
      setSuccess(true);
      setPhone("");
      setRelationship("");
      onSent();
    } else {
      setError(res.message || t("family.inviteFailed"));
    }
  };

  const sensitivityLabel = (s: AlertSensitivity): string =>
    s === "low"
      ? t("family.sensitivityLow")
      : s === "medium"
        ? t("family.sensitivityMedium")
        : t("family.sensitivityHigh");

  return (
    <View className="overflow-hidden rounded-3xl border border-blue-100 bg-white dark:border-blue-900/60 dark:bg-gray-900">
      {/* Hero — the active profile's avatar IS the header icon, so the
          "who is this invite for?" context lives in the title block
          instead of a separate card below. Falls back to a generic
          person-add icon when there's no active profile (edge case). */}
      <View className="flex-row items-center gap-3 bg-blue-50 px-5 py-4 dark:bg-blue-950/30">
        {activeProfile !== null ? (
          <View
            className="h-14 w-14 items-center justify-center rounded-full shadow-sm"
            style={{ backgroundColor: activeProfile.avatarColor }}
          >
            <Text className="text-hero font-bold text-white">
              {activeProfile.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        ) : (
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-blue-900/60">
            <Icon name="person-add" size={26} color="#2563EB" />
          </View>
        )}
        <View className="flex-1">
          <Text className="text-important font-bold text-gray-900 dark:text-gray-100">
            {t("family.inviteTitle")}
          </Text>
          {activeProfile !== null ? (
            <Text
              className="mt-0.5 text-important font-semibold text-primary dark:text-blue-400"
              numberOfLines={1}
            >
              {t("family.inviteForLine", {
                name: `${getFirstName(activeProfile.name)}${t("profile.suffix") ? ` ${t("profile.suffix")}` : ""}`,
                defaultValue: `for ${getFirstName(activeProfile.name)}`,
              })}
            </Text>
          ) : (
            <Text className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
              {t("family.inviteHint")}
            </Text>
          )}
        </View>
      </View>

      <View className="gap-4 px-5 py-5">
        {/* Phone with icon prefix — bigger touch target, clearer affordance.
            The "guardian must already have the app" hint lives here (next
            to the input it explains) now that the header carries the
            profile name instead. */}
        <View>
          <Text className="mb-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t("family.guardianPhone")}
          </Text>
          <View
            className="flex-row items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800"
            style={{ minHeight: TOUCH_TARGET_MIN }}
          >
            <Icon name="call-outline" size={18} color="#9CA3AF" />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="+91 9..."
              placeholderTextColor="#9CA3AF"
              className="flex-1 text-important text-gray-900 dark:text-gray-100"
            />
          </View>
          <Text className="mt-1.5 text-sm text-neutral dark:text-gray-400">
            {t("family.inviteHint")}
          </Text>
        </View>

        {/* Relationship with icon prefix */}
        <View>
          <Text className="mb-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t("family.relationship")}
          </Text>
          <View
            className="flex-row items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800"
            style={{ minHeight: TOUCH_TARGET_MIN }}
          >
            <Icon name="heart-outline" size={18} color="#9CA3AF" />
            <TextInput
              value={relationship}
              onChangeText={setRelationship}
              placeholder="Beta / Beti / Pati / Patni"
              placeholderTextColor="#9CA3AF"
              className="flex-1 text-important text-gray-900 dark:text-gray-100"
            />
          </View>
        </View>

        {/* Alert toggle — softer container makes it feel like a setting,
            not a stray checkbox below a form field. */}
        <Pressable
          onPress={() => setAlertEnabled((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: alertEnabled }}
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="flex-row items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <View
            className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
              alertEnabled
                ? "border-primary bg-primary"
                : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
            }`}
          >
            {alertEnabled && <Icon name="checkmark" size={16} color="#FFFFFF" />}
          </View>
          <Text className="flex-1 text-important font-semibold text-gray-900 dark:text-gray-100">
            {t("family.alertEnabled")}
          </Text>
          <Icon name="notifications-outline" size={18} color="#9CA3AF" />
        </Pressable>

        {/* Sensitivity — color-coded radio cards so the meaning of
            low/medium/high reads visually (green = quiet, red = noisy). */}
        <View>
          <Text className="mb-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t("family.sensitivity")}
          </Text>
          <View className="flex-row gap-2">
            {SENSITIVITIES.map((s) => {
              const active = s.value === sensitivity;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setSensitivity(s.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{ minHeight: TOUCH_TARGET_MIN }}
                  className={`flex-1 items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 ${
                    active
                      ? "border-primary bg-blue-50 dark:bg-blue-950/40"
                      : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                  }`}
                >
                  <View className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                  <Text
                    className={`text-body font-semibold ${
                      active
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {sensitivityLabel(s.value)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error !== null && (
          <View className="flex-row items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <Icon name="alert-circle" size={18} color="#D97706" />
            <Text className="flex-1 text-body text-warning">{error}</Text>
          </View>
        )}
        {success && (
          <View className="flex-row items-center gap-2 rounded-xl bg-green-50 px-3 py-2 dark:bg-green-950/30">
            <Icon name="checkmark-circle" size={18} color="#16A34A" />
            <Text className="flex-1 text-body text-success">{t("family.inviteSent")}</Text>
          </View>
        )}

        <Button
          label={submitting ? t("common.loading") : t("family.inviteSend")}
          disabled={submitting}
          onPress={() => void handleSubmit()}
        />
      </View>
    </View>
  );
};
