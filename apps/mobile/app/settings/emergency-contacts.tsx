// Phase 1 corrigendum — Settings → Emergency Contacts CRUD screen.
//
// One screen, all writes. Lists contacts ordered by priority (1 = top),
// with inline reorder (↑/↓), edit, and delete. The same `EmergencyContactModal`
// powers both Add and Edit.
//
// Active-profile aware: when the household primary is operating a
// sub-profile, `targetUserId` is set so the server reads/writes against
// the sub-profile's contact list (same household-authz pattern as
// /family). Single-profile households just pass undefined and the
// server defaults to the JWT subject.
//
// Reorder strategy is "swap with neighbour" rather than drag-and-drop.
// CLAUDE.md: "Core flows: TAP ONLY. No swipe, no long-press, no drag
// for logging/meds/dashboard" — emergency contacts are adjacent to
// safety flows (the bypass chain reads priority-1 directly), so they
// inherit the same accessibility constraints. Two big tap targets per
// row + a cap-5 list is more usable for elderly users than a drag
// affordance anyway.

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { EmergencyContactModal } from "@/components/settings/EmergencyContactModal";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useProfileStore } from "@/stores/profile.store";
import {
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
  MAX_EMERGENCY_CONTACTS,
  type EmergencyContactDto,
} from "@/services/emergency-contacts";
import { logError } from "@/services/analytics";
import { refreshPriorityContact, storePriorityContact } from "@/services/priority-contact";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function EmergencyContactsScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const activeProfile = useActiveProfile();
  const activeProfileId = activeProfile?.id ?? null;
  const primaryUserId = useProfileStore((s) => s.primaryUserId);

  // When the active profile is the household primary, the server treats
  // a missing `targetUserId` as "the JWT subject's own contacts", which
  // is what we want. When the active profile is a sub-profile we must
  // pass it explicitly. Single-profile households take the same default
  // path as primary.
  const targetUserId =
    activeProfile && primaryUserId && activeProfile.id !== primaryUserId
      ? activeProfile.id
      : undefined;

  const [contacts, setContacts] = useState<readonly EmergencyContactDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContactDto | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const list = await listEmergencyContacts(targetUserId);
      setContacts(list);
      // Keep the critical alert's call target current (audit P2).
      if (activeProfileId) void storePriorityContact(activeProfileId, list);
    } catch (e) {
      logError("emergencyContacts.load", e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, activeProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleAdd = (): void => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (c: EmergencyContactDto): void => {
    setEditing(c);
    setModalOpen(true);
  };

  const handleSubmit = async (input: {
    name: string;
    phone: string;
    relationship: string;
    priority: number;
    isGuardian: boolean;
  }): Promise<void> => {
    if (editing) {
      const next = await updateEmergencyContact(editing.id, input);
      setContacts((prev) =>
        [...prev.filter((c) => c.id !== next.id), next].sort((a, b) => a.priority - b.priority),
      );
      if (activeProfileId) void refreshPriorityContact(activeProfileId);
    } else {
      const created = await createEmergencyContact({ ...input, targetUserId });
      // Server cascades on insert; re-fetch to get the post-renumber
      // priorities for *all* rows, not just the new one.
      await load();
      // Touch `created` to silence unused-var lint; useful as a sanity
      // check if the server returns a row that doesn't appear in the
      // refetch (would surface as a duplicate flash before the list
      // settles — currently impossible).
      void created;
    }
  };

  const handleDelete = (c: EmergencyContactDto): void => {
    Alert.alert(
      t("emergencyContacts.deleteConfirmTitle", {
        defaultValue: "Contact delete karein?",
      }),
      t("emergencyContacts.deleteConfirmBody", {
        name: c.name,
        defaultValue: `${c.name} hat jayenge. Critical alert mein call nahi honge.`,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteEmergencyContact(c.id);
                await load();
              } catch (e) {
                logError("emergencyContacts.delete", e);
              }
            })();
          },
        },
      ],
    );
  };

  // Reorder = swap with a neighbour by priority. The server handles the
  // cascade-shift in a transaction; we just re-fetch on success so the
  // local list mirrors the post-renumber state.
  const handleMove = async (c: EmergencyContactDto, direction: "up" | "down"): Promise<void> => {
    const targetPriority = direction === "up" ? c.priority - 1 : c.priority + 1;
    if (targetPriority < 1 || targetPriority > contacts.length) return;
    try {
      await updateEmergencyContact(c.id, { priority: targetPriority });
      await load();
    } catch (e) {
      logError("emergencyContacts.move", e);
    }
  };

  const atCap = contacts.length >= MAX_EMERGENCY_CONTACTS;
  const nextPriority = contacts.length + 1;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("emergencyContacts.title", { defaultValue: "Emergency Contacts" }),
        }}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {/* Why-this-matters preamble. Elderly users adding their first
            contact need to know "priority 1 = jisko sabse pehle call kiya
            jayega" without reading the spec. */}
        <Card className="border-amber-100 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
          <View className="flex-row items-start gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-white dark:bg-amber-900/60">
              <Icon name="alert-circle" size={20} color="#D97706" />
            </View>
            <View className="flex-1">
              <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
                {t("emergencyContacts.introTitle", {
                  defaultValue: "Critical alerts mein inhe call kiya jayega",
                })}
              </Text>
              <Text className="mt-1 text-body text-gray-700 dark:text-gray-300">
                {t("emergencyContacts.introBody", {
                  defaultValue: "Priority #1 sabse pehle. Maximum 5 contacts add kar sakte hain.",
                })}
              </Text>
            </View>
          </View>
        </Card>

        {loading ? (
          <View className="items-center justify-center py-8">
            <Icon name="hourglass-outline" size={28} color="#9CA3AF" />
            <Text className="mt-2 text-body text-neutral dark:text-gray-400">
              {t("common.loading")}
            </Text>
          </View>
        ) : loadError ? (
          <Card className="items-center py-6">
            <Icon name="cloud-offline-outline" size={32} color="#9CA3AF" />
            <Text className="mt-3 text-center text-body text-neutral dark:text-gray-400">
              {t("emergencyContacts.loadFailed", {
                defaultValue: "Load nahi ho paya. Phir try karein.",
              })}
            </Text>
            <View className="mt-3">
              <Button label={t("common.retry")} variant="secondary" onPress={() => void load()} />
            </View>
          </Card>
        ) : contacts.length === 0 ? (
          <Card className="items-center py-8">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
              <Icon name="call-outline" size={26} color="#9CA3AF" />
            </View>
            <Text className="mt-3 text-center text-important font-semibold text-gray-900 dark:text-gray-100">
              {t("emergencyContacts.emptyTitle", {
                defaultValue: "Abhi koi contact nahi hai",
              })}
            </Text>
            <Text className="mt-1 px-6 text-center text-body text-neutral dark:text-gray-400">
              {t("emergencyContacts.emptyBody", {
                defaultValue: "Pehla contact add karein — emergency mein madad milegi.",
              })}
            </Text>
          </Card>
        ) : (
          contacts.map((c, idx) => (
            <ContactRow
              key={c.id}
              contact={c}
              isFirst={idx === 0}
              isLast={idx === contacts.length - 1}
              onEdit={() => handleEdit(c)}
              onDelete={() => handleDelete(c)}
              onMoveUp={() => void handleMove(c, "up")}
              onMoveDown={() => void handleMove(c, "down")}
            />
          ))
        )}

        <View className="mt-2">
          <Button
            label={
              atCap
                ? t("emergencyContacts.capReached", {
                    max: MAX_EMERGENCY_CONTACTS,
                    defaultValue: `${MAX_EMERGENCY_CONTACTS} contacts ho gaye`,
                  })
                : `+ ${t("emergencyContacts.add", { defaultValue: "Naya contact" })}`
            }
            variant={atCap ? "ghost" : "primary"}
            onPress={handleAdd}
            disabled={atCap || loading}
          />
        </View>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="mt-2 items-center justify-center rounded-2xl p-3"
        >
          <Text className="text-body text-neutral dark:text-gray-400">{t("common.back")}</Text>
        </Pressable>
      </ScrollView>

      <EmergencyContactModal
        visible={modalOpen}
        existing={editing}
        nextPriority={nextPriority}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}

interface RowProps {
  contact: EmergencyContactDto;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const ContactRow = ({
  contact,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: RowProps): JSX.Element => {
  const { t } = useTranslation();
  const priorityIsTop = contact.priority === 1;
  return (
    <Card>
      <View className="flex-row items-start gap-3">
        <View
          className={`h-12 w-12 items-center justify-center rounded-full ${
            priorityIsTop ? "bg-red-100 dark:bg-red-900/40" : "bg-gray-100 dark:bg-gray-800"
          }`}
        >
          <Text
            className={`text-important font-bold ${
              priorityIsTop ? "text-critical" : "text-gray-700 dark:text-gray-200"
            }`}
          >
            #{contact.priority}
          </Text>
        </View>

        <View className="flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
              {contact.name}
            </Text>
            {contact.isGuardian && (
              <View className="rounded-full bg-blue-100 px-2 py-0.5 dark:bg-blue-900/40">
                <Text className="text-xs font-bold text-primary dark:text-blue-300">
                  {t("emergencyContacts.guardianBadge", { defaultValue: "Guardian" })}
                </Text>
              </View>
            )}
          </View>
          <Text className="mt-0.5 text-body text-gray-700 dark:text-gray-300">{contact.phone}</Text>
          <Text className="text-sm text-neutral dark:text-gray-400">
            {t(`emergencyContacts.relationship.${contact.relationship}`, {
              defaultValue: contact.relationship,
            })}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        <Pressable
          onPress={onMoveUp}
          disabled={isFirst}
          accessibilityRole="button"
          accessibilityLabel={t("emergencyContacts.moveUp", { defaultValue: "Upar le jaayein" })}
          style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
          className={`items-center justify-center rounded-xl border px-3 ${
            isFirst
              ? "border-gray-200 opacity-40 dark:border-gray-800"
              : "border-gray-300 dark:border-gray-700"
          }`}
        >
          <Icon name="arrow-up" size={20} color="#6B7280" />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={isLast}
          accessibilityRole="button"
          accessibilityLabel={t("emergencyContacts.moveDown", {
            defaultValue: "Neeche le jaayein",
          })}
          style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
          className={`items-center justify-center rounded-xl border px-3 ${
            isLast
              ? "border-gray-200 opacity-40 dark:border-gray-800"
              : "border-gray-300 dark:border-gray-700"
          }`}
        >
          <Icon name="arrow-down" size={20} color="#6B7280" />
        </Pressable>

        <View className="flex-1" />

        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t("common.edit")}
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="items-center justify-center rounded-xl bg-gray-100 px-4 dark:bg-gray-800"
        >
          <Text className="text-body font-semibold text-gray-700 dark:text-gray-200">
            {t("common.edit")}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={t("common.delete", { defaultValue: "Delete" })}
          style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
          className="items-center justify-center rounded-xl border border-critical px-3"
        >
          <Icon name="trash-outline" size={20} color="#DC2626" />
        </Pressable>
      </View>
    </Card>
  );
};
