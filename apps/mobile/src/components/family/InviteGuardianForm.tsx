// Phase 2 — Invite a guardian form. Phone-first (guardian must already
// have an account; the server returns FAMILY_INVITE_INVALID otherwise
// and we surface a friendly "ask them to install first" copy).

import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { inviteGuardian, type AlertSensitivity } from "@/services/family";
import { normalizeIndianPhone } from "@/utils/phone";

interface InviteGuardianFormProps {
  onSent: () => void;
}

const SENSITIVITIES: readonly AlertSensitivity[] = ["low", "medium", "high"] as const;

export const InviteGuardianForm = ({ onSent }: InviteGuardianFormProps): JSX.Element => {
  const { t } = useTranslation();
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
    <Card>
      <Text className="text-hero font-bold">{t("family.inviteTitle")}</Text>
      <Text className="mt-1 text-body text-neutral">{t("family.inviteHint")}</Text>

      <View className="mt-4 gap-3">
        <View>
          <Text className="text-body text-neutral">{t("family.guardianPhone")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+91 9..."
            placeholderTextColor="#9CA3AF"
            className="mt-1 rounded-xl border border-gray-200 bg-white px-3 text-important"
            style={{ minHeight: TOUCH_TARGET_MIN }}
          />
        </View>

        <View>
          <Text className="text-body text-neutral">{t("family.relationship")}</Text>
          <TextInput
            value={relationship}
            onChangeText={setRelationship}
            placeholder="Beta / Beti / Pati / Patni"
            placeholderTextColor="#9CA3AF"
            className="mt-1 rounded-xl border border-gray-200 bg-white px-3 text-important"
            style={{ minHeight: TOUCH_TARGET_MIN }}
          />
        </View>

        <Pressable
          onPress={() => setAlertEnabled((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: alertEnabled }}
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="flex-row items-center gap-3"
        >
          <View
            className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
              alertEnabled ? "border-primary bg-primary" : "border-gray-300 bg-white"
            }`}
          >
            {alertEnabled && <Icon name="checkmark" size={16} color="#FFFFFF" />}
          </View>
          <Text className="text-important text-gray-900">{t("family.alertEnabled")}</Text>
        </Pressable>

        <View>
          <Text className="text-body text-neutral">{t("family.sensitivity")}</Text>
          <View className="mt-2 flex-row gap-2">
            {SENSITIVITIES.map((s) => {
              const active = s === sensitivity;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSensitivity(s)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{ minHeight: TOUCH_TARGET_MIN }}
                  className={`flex-1 items-center justify-center rounded-xl border-2 px-2 ${
                    active ? "border-primary bg-blue-50" : "border-gray-200 bg-white"
                  }`}
                >
                  <Text
                    className={`text-body font-semibold ${
                      active ? "text-blue-700" : "text-gray-900"
                    }`}
                  >
                    {sensitivityLabel(s)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error !== null && <Text className="text-body text-warning">{error}</Text>}
        {success && <Text className="text-body text-success">{t("family.inviteSent")}</Text>}

        <Button
          label={submitting ? t("common.loading") : t("family.inviteSend")}
          disabled={submitting}
          onPress={() => void handleSubmit()}
        />
      </View>
    </Card>
  );
};
