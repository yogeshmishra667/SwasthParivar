// Phase 2 — Family tab. Two sections on one screen:
//   1. As a *patient*: invite a guardian by phone.
//   2. As a *guardian*: list of accepted patients with a tap-through
//      to their read-only dashboard view.
//
// We don't try to detect role at boot — both surfaces always render
// because shared-phone households commonly have one device acting in
// both roles (Papa logs his sugar AND monitors Maa's BP).

import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { InviteGuardianForm } from "@/components/family/InviteGuardianForm";
import { listPatientsForGuardian, revokeLink, type PatientLinkSummary } from "@/services/family";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function FamilyScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [patients, setPatients] = useState<readonly PatientLinkSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const list = await listPatientsForGuardian("accepted");
    setPatients(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleRevoke = (link: PatientLinkSummary): void => {
    Alert.alert(t("family.revokeConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("family.revoke"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            const updated = await revokeLink(link.linkId);
            if (updated) {
              setPatients((prev) => prev.filter((p) => p.linkId !== link.linkId));
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-hero font-bold">{t("family.title")}</Text>
        <ActiveProfileBadge />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        <Text className="text-important text-neutral">{t("family.subtitle")}</Text>

        {/* Patient → Guardian: invite form. */}
        <InviteGuardianForm onSent={() => void load()} />

        {/* Guardian → Patient: read-only view list. */}
        <View>
          <Text className="mb-2 text-important font-semibold">{t("family.tabPatients")}</Text>
          {loaded && patients.length === 0 ? (
            <Card>
              <Text className="text-body text-neutral">{t("family.noPatients")}</Text>
            </Card>
          ) : (
            <View className="gap-2">
              {patients.map((p) => (
                <PatientRow
                  key={p.linkId}
                  link={p}
                  onView={() =>
                    router.push({
                      pathname: "/patient/[id]",
                      params: { id: p.patient.id, name: p.patient.name },
                    })
                  }
                  onRevoke={() => handleRevoke(p)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface PatientRowProps {
  link: PatientLinkSummary;
  onView: () => void;
  onRevoke: () => void;
}

const PatientRow = ({ link, onView, onRevoke }: PatientRowProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100">
          <Icon name="person" size={24} color="#2563EB" />
        </View>
        <View className="flex-1">
          <Text className="text-important font-semibold">{link.patient.name}</Text>
          {link.relationship !== null && (
            <Text className="text-body text-neutral">{link.relationship}</Text>
          )}
        </View>
      </View>
      <View className="mt-3 flex-row gap-2">
        <Pressable
          onPress={onView}
          accessibilityRole="button"
          accessibilityLabel={t("family.viewDashboard")}
          style={{ minHeight: TOUCH_TARGET_MIN }}
          className="flex-1 items-center justify-center rounded-2xl bg-primary px-4"
        >
          <Text className="text-important font-semibold text-white">
            {t("family.viewDashboard")}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRevoke}
          accessibilityRole="button"
          accessibilityLabel={t("family.revoke")}
          style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
          className="items-center justify-center rounded-2xl border border-critical px-4"
        >
          <Icon name="close-circle" size={20} color="#DC2626" />
        </Pressable>
      </View>
    </Card>
  );
};
