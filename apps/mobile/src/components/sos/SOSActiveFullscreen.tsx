// Phase 4 Feature D' — SOSActiveFullscreen.
//
// Stage-0 UI per phase3.md §M.4: red fullscreen, cannot be dismissed
// for 30 seconds (CRITICAL_FULLSCREEN_LOCK_MS in utils/constants),
// big "Call now" button, stage indicator. Keeps the screen awake
// (expo-keep-awake) for the duration of the active chain so a
// background-throttled OS doesn't kill the cron-tick polling.
//
// Cancel button is intentionally GATED by the 30s lock — a panicked
// patient may try to dismiss before realizing they triggered SOS, and
// the chain should run at least one tick so the guardian sees the
// signal even if the patient cancels right after.
//
// "Call now" routes through expo-linking to the system dialer. We
// pass the priority-1 contact when available; otherwise the patient
// taps "Call emergency contact" and the system shows their contacts.
// This makes the call button useful even when our backend records
// of EmergencyContact are out of sync with what the patient
// remembers as their actual emergency number.

import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CRITICAL_FULLSCREEN_LOCK_MS } from "@/utils/constants";
import { hapticCritical } from "@/utils/haptics";
import { sanitizePhoneForTelUri } from "@/utils/phone";
import type { SOSEventDto, SOSStage } from "@/services/sos";

const KEEP_AWAKE_TAG = "sos-active";

interface SOSActiveFullscreenProps {
  event: SOSEventDto;
  /** Priority-1 emergency contact when known. The dashboard fetches
   *  this from the family/contacts service and passes it down. */
  primaryContact?: { name: string; phone: string } | null;
  onCancel: () => void;
}

const stageLabelKey = (stage: SOSStage): string => {
  switch (stage) {
    case "stage_0_fullscreen":
      return "sos.active.stageFullscreen";
    case "stage_1_auto_dial":
      return "sos.active.stageAutoDial";
    case "stage_2_ivr_call":
      return "sos.active.stageIvr";
    case "stage_3_all_contacts":
      return "sos.active.stageAll";
    default:
      return "sos.active.stageFullscreen";
  }
};

export const SOSActiveFullscreen = ({
  event,
  primaryContact,
  onCancel,
}: SOSActiveFullscreenProps): JSX.Element => {
  const { t } = useTranslation();
  // Cancel-lock countdown. Anchored to the SOS triggeredAt so a
  // re-open of the fullscreen after a background → foreground
  // resumes the correct lock window rather than restarting it.
  const [cancelUnlockedIn, setCancelUnlockedIn] = useState<number>(() => {
    const elapsed = Date.now() - new Date(event.triggeredAt).getTime();
    return Math.max(0, Math.ceil((CRITICAL_FULLSCREEN_LOCK_MS - elapsed) / 1000));
  });

  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    hapticCritical();
    return () => {
      // Newer expo-keep-awake returns a Promise; older returned void.
      // Wrap so both shapes lint clean.
      void Promise.resolve(deactivateKeepAwake(KEEP_AWAKE_TAG));
    };
  }, []);

  useEffect(() => {
    if (cancelUnlockedIn <= 0) return;
    const startedAt = Date.now();
    const initial = cancelUnlockedIn;
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, initial - elapsed);
      setCancelUnlockedIn(next);
      if (next === 0) clearInterval(tick);
    }, 250);
    return () => {
      clearInterval(tick);
    };
  }, [cancelUnlockedIn]);

  const handleCallPrimary = (): void => {
    if (!primaryContact) return;
    const tel = sanitizePhoneForTelUri(primaryContact.phone);
    if (tel.length === 0) return;
    void Linking.openURL(`tel:${tel}`);
  };

  const handleCallGeneric = (): void => {
    // Opens the system dialer with no number — the patient picks from
    // their own contacts. Safer fallback than nothing.
    void Linking.openURL("tel:");
  };

  const canCancel = cancelUnlockedIn === 0;

  return (
    <SafeAreaView className="flex-1 bg-critical">
      <View className="flex-1 items-center justify-between p-6">
        <View className="items-center">
          <Icon name="warning" size={64} color="#FFFFFF" accessibilityLabel="" />
          <Text className="mt-4 text-hero font-bold text-white" accessibilityRole="header">
            {t("sos.active.title")}
          </Text>
          <Text className="mt-2 text-center text-important text-white">
            {t("sos.active.subtitle")}
          </Text>
          <View className="mt-4 rounded-md bg-white/20 px-4 py-2">
            <Text className="text-body text-white">{t(stageLabelKey(event.escalationStage))}</Text>
          </View>
          {event.testMode ? (
            <View className="mt-3 rounded-md border border-white bg-white/10 px-3 py-2">
              <Text className="text-body text-white">{t("sos.active.testModeBadge")}</Text>
            </View>
          ) : null}
        </View>

        <View className="w-full gap-3">
          {primaryContact ? (
            <Button
              label={t("sos.active.callPrimaryButton", { name: primaryContact.name })}
              variant="primary"
              onPress={handleCallPrimary}
              style={{ minHeight: 64 }}
            />
          ) : (
            <Button
              label={t("sos.active.callGenericButton")}
              variant="primary"
              onPress={handleCallGeneric}
              style={{ minHeight: 64 }}
            />
          )}

          <Button
            label={
              canCancel
                ? t("sos.active.cancelButton")
                : t("sos.active.cancelLocked", { seconds: cancelUnlockedIn })
            }
            variant="ghost"
            disabled={!canCancel}
            onPress={canCancel ? onCancel : undefined}
            style={{ backgroundColor: "#FFFFFF", opacity: canCancel ? 1 : 0.5 }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
