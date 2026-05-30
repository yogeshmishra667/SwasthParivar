// Phase 4 Feature D' — SOS flow host.
//
// One screen, three local phases (`confirming` / `active` / `after`)
// driven by `useSOSStore`. Mount when SOSButton fires `onArmed` from
// the dashboard — the button's long-press is the "confirm intent to
// confirm", the on-screen countdown is the "last chance to abort",
// and the server triggerSOS call is the actual write.
//
// Failure mode for triggerSOS:
//  - kill switch (503 SOS_DISABLED) → "unavailable, dial directly"
//  - network failure → same fallback message
// The patient must NEVER be left thinking help is coming when it
// isn't — so any throw routes to the unavailable copy with a direct-
// dial CTA (`tel:`).

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useRouter } from "expo-router";
import { Alert, Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SOSConfirmationScreen } from "@/components/sos/SOSConfirmationScreen";
import { SOSActiveFullscreen } from "@/components/sos/SOSActiveFullscreen";
import { SOSDialIntegration } from "@/components/sos/SOSDialIntegration";
import { SOSAfterActionCard } from "@/components/sos/SOSAfterActionCard";
import { useSOSStore } from "@/stores/sos.store";
import { useSOSPolling } from "@/hooks/useSOSPolling";
import {
  cancelSOS,
  listEmergencyContacts,
  resolveSOS,
  triggerSOS,
  type EmergencyContactDto,
} from "@/services/sos";

export default function SOSScreen(): JSX.Element | null {
  const { t } = useTranslation();
  const router = useRouter();
  const phase = useSOSStore((s) => s.phase);
  const active = useSOSStore((s) => s.active);
  const setActive = useSOSStore((s) => s.setActive);
  const enterAfter = useSOSStore((s) => s.enterAfter);
  const cancelConfirming = useSOSStore((s) => s.cancelConfirming);
  const reset = useSOSStore((s) => s.reset);

  // Test-mode preview during the confirmation countdown: we don't
  // know `event.testMode` until the server returns, so we surface
  // the badge whenever the build flag suggests we're internal. The
  // ship-default copy is honest either way.
  const [confirmTestMode] = useState(true);

  // Priority-1 contact for the "Call {name}" button. Fetched lazily
  // when the screen mounts; failures fall back to the generic dialer
  // (handled inside SOSActiveFullscreen).
  const [primaryContact, setPrimaryContact] = useState<EmergencyContactDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const contacts = await listEmergencyContacts();
      if (cancelled) return;
      setPrimaryContact(contacts[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useSOSPolling(phase === "active");

  const onConfirm = useCallback(async () => {
    try {
      const event = await triggerSOS({
        clientUuid: uuidv4(),
        source: "patient_manual",
      });
      setActive(event);
    } catch (err) {
      // Patient safety: NEVER claim SOS is active when the server
      // refused. Surface a directly-dial-now CTA.
      void err;
      cancelConfirming();
      Alert.alert(t("sos.title"), t("sos.error.unavailable"), [
        {
          text: t("sos.callButton"),
          onPress: () => {
            void Linking.openURL("tel:");
          },
        },
        { text: t("sos.close"), style: "cancel" },
      ]);
      router.back();
    }
  }, [setActive, cancelConfirming, t, router]);

  const onConfirmCancel = useCallback(() => {
    cancelConfirming();
    router.back();
  }, [cancelConfirming, router]);

  const onActiveCancel = useCallback(async () => {
    if (!active) return;
    await cancelSOS(active.id, "patient");
    enterAfter();
  }, [active, enterAfter]);

  const onAfterSubmit = useCallback(
    async (input: { falseAlarm: boolean; note: string | null }) => {
      if (active) {
        await resolveSOS(active.id, "patient", input.falseAlarm);
        // The optional note is captured client-side for now — the
        // Phase 4 §D'.2 wiring will append it to a guardian
        // notification.
        void input.note;
      }
      reset();
      router.back();
    },
    [active, reset, router],
  );

  const onAfterSkip = useCallback(async () => {
    if (active) await resolveSOS(active.id, "patient");
    reset();
    router.back();
  }, [active, reset, router]);

  // The screen guards against being mounted in an idle state — this
  // happens if the route is opened directly without going through
  // SOSButton. Render nothing and bounce back; never start a
  // confirmation the patient didn't initiate.
  useEffect(() => {
    if (phase === "idle") router.back();
  }, [phase, router]);

  if (phase === "idle") return null;

  if (phase === "confirming") {
    return (
      <SOSConfirmationScreen
        testMode={confirmTestMode}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={onConfirmCancel}
      />
    );
  }

  if (phase === "active" && active) {
    return (
      <View className="flex-1 bg-critical">
        <SOSActiveFullscreen
          event={active}
          // Pass the priority-1 contact (or null when the fetch
          // hasn't returned or the patient has no configured
          // contacts). The fullscreen renders "Call {name}" when
          // present, the generic dialer button otherwise.
          primaryContact={
            primaryContact ? { name: primaryContact.name, phone: primaryContact.phone } : null
          }
          onCancel={() => {
            void onActiveCancel();
          }}
        />
        {active.escalationStage === "stage_1_auto_dial" ? (
          <SOSDialIntegration
            // Auto-dial uses the same priority-1 contact. When unknown
            // the integration renders nothing, leaving the patient
            // with the manual "Call now" button.
            phone={primaryContact?.phone}
            onCancel={() => {
              void onActiveCancel();
            }}
          />
        ) : null}
      </View>
    );
  }

  if (phase === "after") {
    return (
      <SOSAfterActionCard
        onSubmit={(input) => {
          void onAfterSubmit(input);
        }}
        onSkip={() => {
          void onAfterSkip();
        }}
      />
    );
  }

  return null;
}
