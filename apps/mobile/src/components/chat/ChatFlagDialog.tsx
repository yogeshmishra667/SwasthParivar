// Phase 3 — AI Chat: flag dialog (phase3.md M.1).
//
// Bottom-sheet modal shown when a patient taps the 🚩 on an assistant
// message. Picks a reason (medical_advice / wrong_info / disrespectful
// / other) plus an optional free-text note. Submit is disabled until a
// reason is chosen.

import { useState } from "react";
import { View, Text, Pressable, TextInput, Modal } from "react-native";
import { useTranslation } from "react-i18next";
import type { ChatFlagReason } from "@/services/chat";

interface ChatFlagDialogProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ChatFlagReason, note?: string) => void;
}

const REASONS: readonly ChatFlagReason[] = [
  "medical_advice",
  "wrong_info",
  "disrespectful",
  "other",
];

export const ChatFlagDialog = ({
  visible,
  onClose,
  onSubmit,
}: ChatFlagDialogProps): JSX.Element => {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ChatFlagReason | null>(null);
  const [note, setNote] = useState("");

  const reset = (): void => {
    setReason(null);
    setNote("");
  };

  const handleSubmit = (): void => {
    if (reason === null) return;
    onSubmit(reason, note.trim().length > 0 ? note.trim() : undefined);
    reset();
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-2xl bg-white p-4">
          <Text className="text-number font-bold text-gray-900">{t("chat.flagDialog.title")}</Text>
          <Text className="mt-1 text-body text-neutral">{t("chat.flagDialog.subtitle")}</Text>

          {REASONS.map((r) => {
            const selected = reason === r;
            return (
              <Pressable
                key={r}
                onPress={() => setReason(r)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`chat.flagDialog.reasons.${r}`)}
                className={`mt-2 min-h-touch flex-row items-center rounded-2xl border px-4 ${
                  selected ? "border-primary bg-blue-50" : "border-gray-200"
                }`}
              >
                <Text className="text-important text-gray-900">
                  {t(`chat.flagDialog.reasons.${r}`)}
                </Text>
              </Pressable>
            );
          })}

          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={t("chat.flagDialog.notePlaceholder")}
            accessibilityLabel={t("chat.flagDialog.notePlaceholder")}
            className="mt-3 max-h-24 rounded-2xl bg-gray-100 px-4 py-2 text-important text-gray-900"
          />

          <View className="mt-4 flex-row gap-2">
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t("chat.flagDialog.cancel")}
              className="min-h-touch flex-1 items-center justify-center rounded-2xl border border-neutral active:opacity-70"
            >
              <Text className="text-important font-semibold text-neutral">
                {t("chat.flagDialog.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={reason === null}
              accessibilityRole="button"
              accessibilityLabel={t("chat.flagDialog.submit")}
              accessibilityState={{ disabled: reason === null }}
              className={`min-h-touch flex-1 items-center justify-center rounded-2xl ${
                reason === null ? "bg-gray-300" : "bg-primary active:opacity-80"
              }`}
            >
              <Text className="text-important font-semibold text-white">
                {t("chat.flagDialog.submit")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};
