// Phase 4 Feature D' — SOSDialIntegration.
//
// Auto-opens the system dialer when the SOS chain reaches
// `stage_1_auto_dial`, with a short user-visible countdown (so a
// patient who hits the SOS button accidentally has one final escape
// before the OS dialer takes over the screen).
//
// "Any tap" cancels per the phase3.md §M.4 spec — tapping the
// countdown card cancels both the auto-dial AND the SOS chain (the
// server records this via cancelSOS). This is the elderly-friendly
// version of "swipe to cancel" — you can't accidentally swipe in a
// dialer, but a tap on the visible card is unambiguous.

import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";
import { sanitizePhoneForTelUri } from "@/utils/phone";

const AUTO_DIAL_PREVIEW_SECONDS = 5;

interface SOSDialIntegrationProps {
  /** The number to dial. When undefined the integration is inert
   *  (renders nothing) — the host screen falls back to manual
   *  contact list selection. */
  phone: string | undefined;
  /** Tap-to-cancel handler. Cancels both the dialer countdown AND
   *  the underlying SOS chain. */
  onCancel: () => void;
  /** Optional: called once the dialer has been opened. The host can
   *  use this to mark the chain "auto-dial fired" client-side. */
  onDialed?: () => void;
}

export const SOSDialIntegration = ({
  phone,
  onCancel,
  onDialed,
}: SOSDialIntegrationProps): JSX.Element | null => {
  const { t } = useTranslation();
  const tel = phone ? sanitizePhoneForTelUri(phone) : "";
  const dialable = tel.length > 0;
  const [remaining, setRemaining] = useState(AUTO_DIAL_PREVIEW_SECONDS);
  const [dialed, setDialed] = useState(false);

  const fireDialer = useCallback(() => {
    if (!dialable || dialed) return;
    setDialed(true);
    void Linking.openURL(`tel:${tel}`);
    onDialed?.();
  }, [dialable, dialed, tel, onDialed]);

  useEffect(() => {
    if (!dialable) return;
    if (dialed) return;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, AUTO_DIAL_PREVIEW_SECONDS - elapsed);
      setRemaining(next);
      if (next === 0) {
        clearInterval(tick);
        fireDialer();
      }
    }, 250);
    return () => {
      clearInterval(tick);
    };
  }, [dialable, dialed, fireDialer]);

  if (!dialable) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("sos.active.openDialerInfo", { seconds: remaining })}
      accessibilityHint={t("sos.active.cancelButton")}
      onPress={onCancel}
      style={{ minHeight: TOUCH_TARGET_MIN }}
      className="m-4 flex-row items-center rounded-2xl bg-white/20 p-4 active:bg-white/30"
    >
      <Icon name="call" size={32} color="#FFFFFF" accessibilityLabel="" />
      <View className="ml-3 flex-1">
        <Text className="text-important font-semibold text-white">
          {dialed
            ? t("sos.active.openDialerNow")
            : t("sos.active.openDialerInfo", { seconds: remaining })}
        </Text>
        <Text className="text-body text-white">{t("sos.active.cancelButton")}</Text>
      </View>
    </Pressable>
  );
};
