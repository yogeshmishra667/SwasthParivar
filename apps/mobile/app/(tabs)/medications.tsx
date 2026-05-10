import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TextInput, Alert, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import {
  cancelMedReminders,
  reconcileMedReminders,
  syncMedReminders,
} from "@/services/medication-reminders";
import { hapticSave } from "@/utils/haptics";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface Schedule {
  id: string;
  medicineName: string;
  dosage: string | null;
  timeSlots: string[];
  isCritical: boolean;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default function MedicationsScreen(): JSX.Element {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await api.get<{ success: boolean; data: Schedule[] }>("/medications/schedule");
      setSchedules(res.data);
      // Reconcile local reminders with server truth on every load.
      // Fixes drift from re-install, force-quit, or a missed sync.
      // Fire-and-forget — failures shouldn't block the UI.
      void reconcileMedReminders(
        res.data.map((s) => ({
          id: s.id,
          medicineName: s.medicineName,
          timeSlots: s.timeSlots,
        })),
      );
    } catch {
      setError(t("medications.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = (s: Schedule): void => {
    Alert.alert(t("medications.removeConfirm", { name: s.medicineName }), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("medications.remove"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await api.delete(`/medications/schedule/${s.id}`);
              setSchedules((prev) => prev.filter((x) => x.id !== s.id));
              await cancelMedReminders(s.id);
            } catch {
              setError(t("medications.saveFailed"));
            }
          })();
        },
      },
    ]);
  };

  const handleLog = async (s: Schedule, status: "taken" | "skipped"): Promise<void> => {
    hapticSave();
    const key = `${s.id}-${status}`;
    try {
      await api.post("/medications/log", {
        scheduleId: s.id,
        status,
        scheduledFor: new Date().toISOString(),
      });
      setLoggedIds((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setLoggedIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    } catch {
      setError(t("medications.saveFailed"));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between p-4">
        <Text className="text-hero font-bold">{t("medications.title")}</Text>
        <ActiveProfileBadge />
      </View>

      {error !== null && (
        <View className="mx-4 mb-2">
          <Text className="text-body text-warning">{error}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
        {loading ? (
          <ActivityIndicator />
        ) : schedules.length === 0 && !showForm ? (
          <Card>
            <Text className="text-important">{t("medications.noMedicines")}</Text>
            <Text className="text-body text-neutral">{t("medications.addFromSettings")}</Text>
          </Card>
        ) : (
          schedules.map((s) => (
            <Card key={s.id}>
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-important font-semibold">{s.medicineName}</Text>
                  {s.dosage && <Text className="text-body text-neutral">{s.dosage}</Text>}
                  <Text className="text-body mt-1">{s.timeSlots.join(" · ")}</Text>
                </View>
                <Pressable
                  onPress={() => handleDelete(s)}
                  accessibilityRole="button"
                  accessibilityLabel={t("medications.remove")}
                  style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
                  className="items-center justify-center"
                >
                  <Icon name="trash-outline" size={24} color="#DC2626" />
                </Pressable>
              </View>
              <View className="mt-3 flex-row gap-2">
                <View className="flex-1">
                  <Button
                    label={
                      loggedIds.has(`${s.id}-taken`)
                        ? t("medications.logged")
                        : t("medications.markTaken")
                    }
                    variant="primary"
                    onPress={() => void handleLog(s, "taken")}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    label={
                      loggedIds.has(`${s.id}-skipped`)
                        ? t("medications.logged")
                        : t("medications.markSkipped")
                    }
                    variant="ghost"
                    onPress={() => void handleLog(s, "skipped")}
                  />
                </View>
              </View>
            </Card>
          ))
        )}

        {showForm ? (
          <AddMedicineForm
            onCancel={() => setShowForm(false)}
            onSaved={(s) => {
              setSchedules((prev) => [...prev, s]);
              setShowForm(false);
              // Schedule the local reminder on every slot. Async, no
              // need to block the UI — schedule failure is logged but
              // the schedule itself is persisted server-side.
              void syncMedReminders(s.id, s.medicineName, s.timeSlots);
            }}
            onError={() => setError(t("medications.saveFailed"))}
            invalidTimeMsg={t("medications.invalidTime")}
          />
        ) : (
          <Button label={`+ ${t("medications.addNew")}`} onPress={() => setShowForm(true)} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface FormProps {
  onCancel: () => void;
  onSaved: (s: Schedule) => void;
  onError: () => void;
  invalidTimeMsg: string;
}

function AddMedicineForm({ onCancel, onSaved, onError, invalidTimeMsg }: FormProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [timeInput, setTimeInput] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addSlot = (): void => {
    const v = timeInput.trim();
    if (!HHMM_RE.test(v)) {
      setTimeError(invalidTimeMsg);
      return;
    }
    if (slots.includes(v)) {
      setTimeInput("");
      return;
    }
    setSlots([...slots, v].sort());
    setTimeInput("");
    setTimeError(null);
  };

  const removeSlot = (s: string): void => {
    setSlots(slots.filter((x) => x !== s));
  };

  const canSave = name.trim().length > 0 && slots.length > 0 && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await api.post<{ success: boolean; data: Schedule }>("/medications/schedule", {
        medicineName: name.trim(),
        ...(dosage.trim() ? { dosage: dosage.trim() } : {}),
        timeSlots: slots,
        isCritical: false,
      });
      hapticSave();
      onSaved(res.data);
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Text className="text-important font-semibold mb-3">{t("medications.addNew")}</Text>

      <Text className="text-body mb-1">{t("medications.medicineName")}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t("medications.medicineName")}
        className="border border-neutral rounded-xl px-3 py-3 mb-3 text-body"
        style={{ minHeight: TOUCH_TARGET_MIN }}
      />

      <Text className="text-body mb-1">{t("medications.dosage")}</Text>
      <TextInput
        value={dosage}
        onChangeText={setDosage}
        placeholder={t("medications.dosage")}
        className="border border-neutral rounded-xl px-3 py-3 mb-3 text-body"
        style={{ minHeight: TOUCH_TARGET_MIN }}
      />

      <Text className="text-body mb-1">{t("medications.timeSlots")}</Text>
      <Text className="text-body text-neutral mb-2">{t("medications.timeSlotHint")}</Text>

      <View className="flex-row gap-2 mb-2">
        <TextInput
          value={timeInput}
          onChangeText={setTimeInput}
          placeholder="08:00"
          keyboardType="numbers-and-punctuation"
          className="flex-1 border border-neutral rounded-xl px-3 py-3 text-body"
          style={{ minHeight: TOUCH_TARGET_MIN }}
        />
        <Button label={t("medications.addTime")} variant="secondary" onPress={addSlot} />
      </View>

      {timeError !== null && <Text className="text-body text-warning mb-2">{timeError}</Text>}

      {slots.length > 0 && (
        <View className="flex-row flex-wrap gap-2 mb-3">
          {slots.map((s) => (
            <Pressable
              key={s}
              onPress={() => removeSlot(s)}
              accessibilityRole="button"
              accessibilityLabel={`${s} ${t("medications.remove")}`}
              className="flex-row items-center gap-1 bg-gray-100 rounded-full px-3 py-2"
              style={{ minHeight: TOUCH_TARGET_MIN }}
            >
              <Text className="text-body">{s}</Text>
              <Icon name="close" size={16} color="#6B7280" />
            </Pressable>
          ))}
        </View>
      )}

      <View className="flex-row gap-2 mt-2">
        <View className="flex-1">
          <Button label={t("common.cancel")} variant="ghost" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <Button
            label={t("medications.save")}
            onPress={() => void save()}
            disabled={!canSave}
          />
        </View>
      </View>
    </Card>
  );
}
