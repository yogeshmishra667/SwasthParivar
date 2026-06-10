// Phase 4 §F.13 — the per-prescription "Approve" action.
//
// Encodes the §F.10 solo-patient friction: when there is no guardian
// (`frictionLevel === "high"`) the approver must pass through a re-confirm
// modal whose confirm button stays disabled for a 3-second read delay
// (CLAUDE.md double-confirmation pattern). With a guardian
// (`frictionLevel === "none"`) approval is a single tap — the guardian IS
// the safety check.

import { useEffect, useState } from "react";
import { Modal, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";

const SOLO_DELAY_SECONDS = 3;

interface Props {
  frictionLevel: "none" | "high";
  disabled?: boolean;
  submitting?: boolean;
  onApprove: () => void;
}

export const ApproveAllButton = ({
  frictionLevel,
  disabled = false,
  submitting = false,
  onApprove,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [secsLeft, setSecsLeft] = useState(SOLO_DELAY_SECONDS);

  useEffect(() => {
    if (!modalOpen) return;
    setSecsLeft(SOLO_DELAY_SECONDS);
    const id = setInterval(() => {
      setSecsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [modalOpen]);

  const label = submitting
    ? t("prescriptions.actions.approving")
    : t("prescriptions.actions.approveAll");

  const onPrimaryPress = (): void => {
    if (frictionLevel === "high") {
      setModalOpen(true);
      return;
    }
    onApprove();
  };

  return (
    <>
      <Button
        label={label}
        onPress={onPrimaryPress}
        disabled={disabled || submitting}
        style={disabled || submitting ? { opacity: 0.5 } : undefined}
        accessibilityState={{ disabled: disabled || submitting }}
      />

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full rounded-2xl bg-white p-5 dark:bg-gray-900">
            <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
              {t("prescriptions.solo.confirmTitle")}
            </Text>
            <Text className="mb-5 text-body text-gray-600 dark:text-gray-300">
              {t("prescriptions.solo.confirmBody")}
            </Text>
            <Button
              label={
                secsLeft > 0
                  ? t("prescriptions.solo.wait", { secs: secsLeft })
                  : t("prescriptions.solo.confirmYes")
              }
              variant="critical"
              disabled={secsLeft > 0}
              style={secsLeft > 0 ? { opacity: 0.5 } : undefined}
              accessibilityState={{ disabled: secsLeft > 0 }}
              onPress={() => {
                setModalOpen(false);
                onApprove();
              }}
            />
            <Button
              label={t("prescriptions.solo.confirmNo")}
              variant="ghost"
              style={{ marginTop: 10 }}
              onPress={() => setModalOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};
