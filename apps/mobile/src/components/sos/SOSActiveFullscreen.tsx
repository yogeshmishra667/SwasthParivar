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
   *  this from the family/contacts service and passes it down. The
   *  `relationship` is shown beneath the name on the contact card
   *  ("son" / "spouse" / etc.) so the patient can confirm at a glance
   *  who they're about to dial — not just a context-less number. */
  primaryContact?: { name: string; phone: string; relationship?: string } | null;
  onCancel: () => void;
}

// Friendly E.164 → "+91 98 1234 5670" presentation for the contact
// card. Falls back to the raw phone if the shape doesn't match the
// expected Indian mobile format — never throws.
const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, "");
  const match = /^\+91(\d{2})(\d{4})(\d{4})$/.exec(cleaned);
  if (!match) return phone;
  return `+91 ${match[1]} ${match[2]} ${match[3]}`;
};

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
      <View className="flex-1 justify-between p-5">
        {/* Top — test-mode chip (when applicable), big iconography,
            title + subtitle, stage chip. */}
        <View>
          {event.testMode ? (
            <View className="self-center rounded-full bg-amber-100 px-3 py-1.5">
              <Text className="text-xs font-bold uppercase tracking-wider text-amber-800">
                {t("sos.active.testModeBadge")}
              </Text>
            </View>
          ) : null}

          <View className="mt-6 items-center">
            <View
              style={{
                height: 88,
                width: 88,
                borderRadius: 44,
                backgroundColor: "rgba(255,255,255,0.15)",
                borderWidth: 2,
                borderColor: "rgba(255,255,255,0.4)",
              }}
              className="items-center justify-center"
            >
              <Icon name="warning" size={48} color="#FFFFFF" accessibilityLabel="" />
            </View>
            <Text className="mt-5 text-hero font-bold text-white" accessibilityRole="header">
              {t("sos.active.title")}
            </Text>
            <Text className="mt-2 text-center text-important text-white/90">
              {t("sos.active.subtitle")}
            </Text>
          </View>

          {/* Stage indicator — pill with live region so a screen reader
              announces transitions as the escalation chain advances. */}
          <View className="mt-6 self-center flex-row items-center gap-2 rounded-full bg-white/15 px-4 py-2">
            <View
              style={{
                height: 8,
                width: 8,
                borderRadius: 4,
                backgroundColor: "#FFFFFF",
              }}
            />
            <Text className="text-body font-medium text-white" accessibilityLiveRegion="polite">
              {t(stageLabelKey(event.escalationStage))}
            </Text>
          </View>
        </View>

        {/* Primary-contact card — visual center of gravity. The "Call
            now" CTA lives INSIDE the card so the patient confirms WHO
            they're calling before tapping, not after. */}
        <View className="rounded-3xl bg-white p-5 shadow-2xl">
          <Text className="text-xs font-semibold uppercase tracking-wider text-red-700">
            {primaryContact
              ? t("sos.active.callPrimaryButton", { name: "" }).trim()
              : t("sos.active.stageFullscreen")}
          </Text>

          {primaryContact ? (
            <>
              <Text className="mt-2 text-hero font-bold text-foreground" numberOfLines={1}>
                {primaryContact.name}
              </Text>
              {primaryContact.relationship ? (
                <Text className="text-body text-neutral">{primaryContact.relationship}</Text>
              ) : null}
              <Text className="mt-1 text-important font-medium text-foreground">
                {formatPhone(primaryContact.phone)}
              </Text>
              <View className="mt-4">
                <Button
                  label={t("sos.active.callPrimaryButton", { name: primaryContact.name })}
                  variant="critical"
                  onPress={handleCallPrimary}
                  style={{ minHeight: 64 }}
                />
              </View>
            </>
          ) : (
            <>
              <Text className="mt-2 text-important font-medium text-foreground">
                {t("sos.active.subtitle")}
              </Text>
              <View className="mt-4">
                <Button
                  label={t("sos.active.callGenericButton")}
                  variant="critical"
                  onPress={handleCallGeneric}
                  style={{ minHeight: 64 }}
                />
              </View>
            </>
          )}
        </View>

        {/* Cancel — gated by the 30s lock. Disabled state shows the
            remaining seconds + a live region so a screen reader
            announces the countdown. */}
        <View>
          <Button
            label={
              canCancel
                ? t("sos.active.cancelButton")
                : t("sos.active.cancelLocked", { seconds: cancelUnlockedIn })
            }
            variant="ghost"
            disabled={!canCancel}
            onPress={canCancel ? onCancel : undefined}
            style={{
              backgroundColor: "rgba(255,255,255,0.95)",
              opacity: canCancel ? 1 : 0.65,
              minHeight: 52,
            }}
            accessibilityLiveRegion="polite"
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
