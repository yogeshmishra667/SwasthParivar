// Phase 4 §F.13 — prescription detail. One screen, two faces:
//
//   • Approver (guardian, or solo patient): editable item cards, append +
//     manual-add CTAs, and the per-prescription Approve button (which
//     carries the §F.10 solo friction). The Approve button is NEVER a
//     sticky bottom bar on a multi-item list — the approver scrolls past
//     every item before reaching it (intentional friction).
//   • Patient (guardian required, not the approver): read-only, with a
//     "sent to <guardian>" banner and a resend-nudge after the first hour.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CameraCaptureModal } from "@/components/prescriptions/CameraCaptureModal";
import { ApproveAllButton } from "@/components/prescriptions/ApproveAllButton";
import {
  PrescriptionItemCard,
  type ItemDraft,
} from "@/components/prescriptions/PrescriptionItemCard";
import {
  addManualItem,
  appendPhotos,
  approvePrescription,
  clarifyItem,
  getPrescription,
  type PrescriptionItemView,
  type PrescriptionView,
} from "@/services/prescriptions";
import { useAuthStore } from "@/stores/auth.store";
import { logError } from "@/services/analytics";
import { isPrescriptionApprover } from "@/utils/isPrescriptionApprover";

const draftFor = (item: PrescriptionItemView): ItemDraft => ({
  decision: "approve",
  verifiedMedicineName: item.verifiedMedicineName ?? item.ocrMedicineName,
  verifiedDosage: item.verifiedDosage ?? item.ocrDosage,
  verifiedFrequency: item.verifiedFrequency ?? item.ocrFrequency,
});

const isTerminal = (s: string): boolean =>
  s === "approved" || s === "rejected" || s === "needs_doctor";

export default function PrescriptionDetailScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const currentUserId = useAuthStore((s) => s.userId);

  const [view, setView] = useState<PrescriptionView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // clarify / append camera target
  const [cameraMode, setCameraMode] = useState<
    null | { kind: "clarify"; item: PrescriptionItemView } | { kind: "append" }
  >(null);
  const [typeModal, setTypeModal] = useState<null | { item: PrescriptionItemView }>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const data = await getPrescription(id);
      setView(data);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of data.items) next[item.id] ??= draftFor(item);
        return next;
      });
      setError(null);
    } catch (err) {
      logError("prescription-detail", err);
      setError(t("prescriptions.errors.loadFailed"));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Both ids must be real: a signed-out `null` must never match the
  // `null` approver of a prescription whose guardian is gone (audit P6).
  const isApprover = isPrescriptionApprover(view?.approverUserId, currentUserId);
  const patientWaiting = view !== null && view.requiresGuardianApproval && !isApprover;
  const noGuardianLinked = patientWaiting && view.approverUserId === null;

  const editableItems = useMemo(
    () => (view?.items ?? []).filter((i) => !isTerminal(i.status)),
    [view],
  );
  const canApprove =
    editableItems.length > 0 && editableItems.some((i) => i.ocrColor !== "need_clarification");

  const setDraft = (itemId: string, partial: Partial<ItemDraft>): void => {
    setDrafts((d) => ({ ...d, [itemId]: { ...d[itemId]!, ...partial } }));
  };

  const onApprove = async (): Promise<void> => {
    if (!view) return;
    setSubmitting(true);
    try {
      // need_clarification items can't be approved — they're excluded.
      const decisions = editableItems
        .filter((i) => i.ocrColor !== "need_clarification")
        .map((i) => {
          const d = drafts[i.id]!;
          return d.decision === "approve"
            ? {
                id: i.id,
                decision: "approve" as const,
                verifiedMedicineName: d.verifiedMedicineName,
                verifiedDosage: d.verifiedDosage,
                verifiedFrequency: d.verifiedFrequency,
              }
            : { id: i.id, decision: d.decision };
        });
      await approvePrescription(view.id, decisions);
      const solo = view.approverFrictionLevel === "high";
      await load();
      if (solo) setShowNudge(true);
    } catch (err) {
      logError("prescription-approve", err);
      setError(t("prescriptions.errors.approveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const onClarify = (item: PrescriptionItemView, mode: "photo" | "type"): void => {
    if (mode === "photo") setCameraMode({ kind: "clarify", item });
    else setTypeModal({ item });
  };

  const onCameraCapture = async (uri: string): Promise<void> => {
    const target = cameraMode;
    setCameraMode(null);
    if (!view || !target) return;
    const photo = { uri, name: `photo-${Date.now()}.jpg` };
    try {
      if (target.kind === "clarify") {
        await clarifyItem(view.id, target.item.id, {
          photo,
          clarificationAttemptId: uuidv4(),
        });
      } else {
        await appendPhotos(view.id, {
          prescriptionPhotos: [photo],
          medicinePhotos: [],
          deltaUploadId: uuidv4(),
        });
      }
      await load();
    } catch (err) {
      logError("prescription-action", err);
      setError(t("prescriptions.errors.actionFailed"));
    }
  };

  if (!view) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Stack.Screen options={{ headerShown: true, title: t("prescriptions.title") }} />
        <Text className="text-body text-gray-500">
          {error ?? t("prescriptions.status.pending_ocr")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ headerShown: true, title: t("prescriptions.title") }} />
      <ScrollView
        className="flex-1 px-4 pt-3"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        <Text className="mb-3 text-body font-semibold text-gray-500 dark:text-gray-400">
          {t(`prescriptions.status.${view.status}`)}
        </Text>

        {patientWaiting ? (
          <Card className="mb-4 border-amber-200 bg-amber-50 dark:bg-amber-900/20">
            <Text className="text-important font-semibold text-warning">
              {noGuardianLinked
                ? t("prescriptions.patient.noGuardianLinked")
                : t("prescriptions.patient.sentToGuardianGeneric")}
            </Text>
            <Text className="mt-1 text-body text-gray-600 dark:text-gray-300">
              {t("prescriptions.patient.readOnly")}
            </Text>
          </Card>
        ) : null}

        {error ? <Text className="mb-3 text-body text-critical">{error}</Text> : null}

        {view.items.map((item) => (
          <PrescriptionItemCard
            key={item.id}
            item={item}
            readOnly={!isApprover}
            draft={drafts[item.id] ?? draftFor(item)}
            onDraftChange={(partial) => setDraft(item.id, partial)}
            onClarify={onClarify}
          />
        ))}

        {isApprover && view.status !== "approved" && view.status !== "rejected" ? (
          <View className="mb-4 mt-1 flex-row">
            <Button
              label={t("prescriptions.actions.addPhotos")}
              variant="secondary"
              style={{ flex: 1, marginRight: 8 }}
              onPress={() => setCameraMode({ kind: "append" })}
            />
            <Button
              label={t("prescriptions.actions.addManual")}
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => setManualOpen(true)}
            />
          </View>
        ) : null}

        {isApprover && view.status !== "approved" && view.status !== "rejected" ? (
          <View className="mb-8 mt-2">
            <ApproveAllButton
              frictionLevel={view.approverFrictionLevel}
              disabled={!canApprove}
              submitting={submitting}
              onApprove={() => void onApprove()}
            />
          </View>
        ) : null}
      </ScrollView>

      <CameraCaptureModal
        visible={cameraMode !== null}
        onCapture={(uri) => void onCameraCapture(uri)}
        onClose={() => setCameraMode(null)}
      />

      <TypeNameModal
        item={typeModal?.item ?? null}
        onClose={() => setTypeModal(null)}
        onSubmit={async (name) => {
          const item = typeModal?.item;
          setTypeModal(null);
          if (!item) return;
          try {
            await clarifyItem(view.id, item.id, {
              typedMedicineName: name,
              clarificationAttemptId: uuidv4(),
            });
            await load();
          } catch (err) {
            logError("prescription-clarify", err);
            setError(t("prescriptions.errors.actionFailed"));
          }
        }}
      />

      <ManualAddModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={async (fields) => {
          setManualOpen(false);
          try {
            await addManualItem(view.id, { ...fields, addAttemptId: uuidv4() });
            await load();
          } catch (err) {
            logError("prescription-manual-add", err);
            setError(t("prescriptions.errors.actionFailed"));
          }
        }}
      />

      <NudgeModal
        open={showNudge}
        onClose={() => setShowNudge(false)}
        onAddFamily={() => {
          setShowNudge(false);
          router.push("/(tabs)/family");
        }}
      />
    </SafeAreaView>
  );
}

// ── inline modals ────────────────────────────────────────────────────

function TypeNameModal({
  item,
  onClose,
  onSubmit,
}: {
  item: PrescriptionItemView | null;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full rounded-2xl bg-white p-5 dark:bg-gray-900">
          <Text className="mb-3 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("prescriptions.item.typeName")}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("prescriptions.item.name")}
            placeholderTextColor="#9CA3AF"
            className="mb-4 rounded-xl border border-gray-300 px-3 text-important text-gray-900 dark:border-gray-700 dark:text-gray-100"
            style={{ minHeight: 48 }}
          />
          <Button
            label={t("prescriptions.actions.clarifySubmit")}
            disabled={name.trim().length === 0}
            style={name.trim().length === 0 ? { opacity: 0.5 } : undefined}
            onPress={() => {
              void onSubmit(name.trim());
              setName("");
            }}
          />
          <Button
            label={t("prescriptions.camera.cancel")}
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

function ManualAddModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (fields: {
    typedMedicineName: string;
    typedDosage: string;
    typedFrequency: string;
    approverNote?: string;
  }) => void | Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const valid = name.trim() && dosage.trim() && frequency.trim();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full rounded-2xl bg-white p-5 dark:bg-gray-900">
          <Text className="mb-3 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("prescriptions.manual.title")}
          </Text>
          <ModalField
            placeholder={t("prescriptions.manual.name")}
            value={name}
            onChangeText={setName}
          />
          <ModalField
            placeholder={t("prescriptions.manual.dosage")}
            value={dosage}
            onChangeText={setDosage}
          />
          <ModalField
            placeholder={t("prescriptions.manual.frequency")}
            value={frequency}
            onChangeText={setFrequency}
          />
          <Button
            label={t("prescriptions.actions.saveManual")}
            disabled={!valid}
            style={!valid ? { opacity: 0.5 } : undefined}
            onPress={() => {
              void onSubmit({
                typedMedicineName: name.trim(),
                typedDosage: dosage.trim(),
                typedFrequency: frequency.trim(),
              });
              setName("");
              setDosage("");
              setFrequency("");
            }}
          />
          <Button
            label={t("prescriptions.camera.cancel")}
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

function ModalField({
  placeholder,
  value,
  onChangeText,
}: {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
}): JSX.Element {
  return (
    <TextInput
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      value={value}
      onChangeText={onChangeText}
      className="mb-3 rounded-xl border border-gray-300 px-3 text-important text-gray-900 dark:border-gray-700 dark:text-gray-100"
      style={{ minHeight: 48 }}
    />
  );
}

function NudgeModal({
  open,
  onClose,
  onAddFamily,
}: {
  open: boolean;
  onClose: () => void;
  onAddFamily: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full rounded-2xl bg-white p-5 dark:bg-gray-900">
          <Text className="mb-2 text-important font-bold text-gray-900 dark:text-gray-100">
            {t("prescriptions.solo.nudgeTitle")}
          </Text>
          <Text className="mb-5 text-body text-gray-600 dark:text-gray-300">
            {t("prescriptions.solo.nudgeBody")}
          </Text>
          <Button label={t("prescriptions.solo.nudgeCta")} onPress={onAddFamily} />
          <Button
            label={t("prescriptions.solo.nudgeDismiss")}
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}
