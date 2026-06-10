// Phase 4 §F.13 — one prescription item on the approver screen.
//
// Colour drives the banner + the friction:
//   green  → looks correct, one-tap approve
//   yellow → editable fields, approve enabled once name is present
//   red    → editable fields + "take a photo" to re-check
//   need_clarification → parked; CTAs to photograph or type the name
//
// Terminal items (approved / rejected / needs_doctor) render read-only with
// a tag. The patient (non-approver) view passes `readOnly` for everything.

import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { PrescriptionItemColor } from "@swasth/shared-types";

import { Button } from "@/components/ui/Button";
import type { PrescriptionItemView } from "@/services/prescriptions";

export interface ItemDraft {
  decision: "approve" | "reject" | "needs_doctor";
  verifiedMedicineName: string;
  verifiedDosage: string;
  verifiedFrequency: string;
}

interface Props {
  item: PrescriptionItemView;
  readOnly: boolean;
  draft: ItemDraft;
  onDraftChange: (partial: Partial<ItemDraft>) => void;
  onClarify: (item: PrescriptionItemView, mode: "photo" | "type") => void;
}

const BANNER: Record<PrescriptionItemColor, { bg: string; text: string }> = {
  green: { bg: "bg-green-50 dark:bg-green-900/30", text: "text-success" },
  yellow: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-warning" },
  red: { bg: "bg-red-50 dark:bg-red-900/30", text: "text-critical" },
  need_clarification: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-warning" },
};

export const PrescriptionItemCard = ({
  item,
  readOnly,
  draft,
  onDraftChange,
  onClarify,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const banner = BANNER[item.ocrColor];
  const pct = Math.round(item.ocrConfidence * 100);

  const terminalTag =
    item.status === "approved"
      ? t("prescriptions.item.approvedTag")
      : item.status === "rejected"
        ? t("prescriptions.item.rejectedTag")
        : item.status === "needs_doctor"
          ? t("prescriptions.item.needsDoctorTag")
          : null;

  return (
    <View className="mb-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
      <View className={`px-4 py-2 ${banner.bg}`}>
        <Text className={`text-body font-semibold ${banner.text}`}>
          {t(`prescriptions.item.${item.ocrColor}`)}
          {item.ocrConfidence > 0 ? `  ·  ${t("prescriptions.item.confidence", { pct })}` : ""}
        </Text>
      </View>

      <View className="bg-white p-4 dark:bg-gray-900">
        {terminalTag ? (
          <>
            <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
              {item.verifiedMedicineName ?? item.ocrMedicineName}
            </Text>
            <Text className="mt-1 text-body text-gray-500">{terminalTag}</Text>
          </>
        ) : item.ocrColor === "need_clarification" && !readOnly ? (
          <>
            <Text className="mb-3 text-body text-gray-600 dark:text-gray-300">
              {t("prescriptions.item.needClarificationBody")}
            </Text>
            <View className="flex-row">
              <Button
                label={t("prescriptions.item.takePhoto")}
                variant="secondary"
                style={{ flex: 1, marginRight: 8 }}
                onPress={() => onClarify(item, "photo")}
              />
              <Button
                label={t("prescriptions.item.typeName")}
                variant="ghost"
                style={{ flex: 1 }}
                onPress={() => onClarify(item, "type")}
              />
            </View>
          </>
        ) : readOnly ? (
          <>
            <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
              {item.verifiedMedicineName ?? item.ocrMedicineName}
            </Text>
            <Text className="mt-1 text-body text-gray-500">
              {(item.verifiedDosage ?? item.ocrDosage) || ""}
              {"  ·  "}
              {(item.verifiedFrequency ?? item.ocrFrequency) || ""}
            </Text>
          </>
        ) : (
          <>
            <Field
              label={t("prescriptions.item.name")}
              value={draft.verifiedMedicineName}
              onChangeText={(v) => onDraftChange({ verifiedMedicineName: v })}
            />
            <Field
              label={t("prescriptions.item.dosage")}
              value={draft.verifiedDosage}
              onChangeText={(v) => onDraftChange({ verifiedDosage: v })}
            />
            <Field
              label={t("prescriptions.item.frequency")}
              value={draft.verifiedFrequency}
              onChangeText={(v) => onDraftChange({ verifiedFrequency: v })}
            />
            <View className="mt-2 flex-row">
              <Toggle
                label={t("prescriptions.actions.approve")}
                active={draft.decision === "approve"}
                variant="approve"
                onPress={() => onDraftChange({ decision: "approve" })}
              />
              <Toggle
                label={t("prescriptions.actions.markNeedsDoctor")}
                active={draft.decision === "needs_doctor"}
                variant="doctor"
                onPress={() => onDraftChange({ decision: "needs_doctor" })}
              />
              <Toggle
                label={t("prescriptions.actions.reject")}
                active={draft.decision === "reject"}
                variant="reject"
                onPress={() => onDraftChange({ decision: "reject" })}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
};

const Field = ({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}): JSX.Element => (
  <View className="mb-3">
    <Text className="mb-1 text-body text-gray-500 dark:text-gray-400">{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      className="rounded-xl border border-gray-300 bg-white px-3 text-important text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      style={{ minHeight: 48 }}
      placeholderTextColor="#9CA3AF"
    />
  </View>
);

const TOGGLE_COLOR: Record<"approve" | "doctor" | "reject", string> = {
  approve: "#16A34A", // success
  doctor: "#D97706", // warning
  reject: "#DC2626", // critical
};

const Toggle = ({
  label,
  active,
  variant,
  onPress,
}: {
  label: string;
  active: boolean;
  variant: "approve" | "doctor" | "reject";
  onPress: () => void;
}): JSX.Element => (
  <Button
    label={label}
    variant={active ? "primary" : "ghost"}
    onPress={onPress}
    style={[
      { flex: 1, marginRight: variant === "reject" ? 0 : 8, paddingHorizontal: 4 },
      active ? { backgroundColor: TOGGLE_COLOR[variant] } : undefined,
    ]}
    textStyle={{ fontSize: 13 }}
  />
);
