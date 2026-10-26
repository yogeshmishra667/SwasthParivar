import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Linking, BackHandler } from "react-native";
import { useTranslation } from "react-i18next";
import { CRITICAL_AUTO_DIAL_MS, CRITICAL_FULLSCREEN_LOCK_MS } from "@/utils/constants";
import { sanitizePhoneForTelUri } from "@/utils/phone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { hapticCritical } from "@/utils/haptics";
import { track } from "@/services/analytics";
import { usePriorityContact } from "@/hooks/usePriorityContact";

const EMERGENCY_NUMBER = "112";

interface CriticalAlertProps {
  visible: boolean;
  value: number;
  direction: "low" | "high";
  /** Picks the copy. Defaults to glucose (the Phase 1 alert). */
  category?: "glucose" | "bp";
  /** Reading as shown, e.g. "190/120 mmHg". Defaults to "<value> mg/dL". */
  valueLabel?: string;
  /**
   * The profile the reading belongs to. Its priority-1 emergency contact
   * is the call target (audit P2); 112 is always offered as well.
   */
  userId: string | null;
  onDismiss: () => void;
}

const LOCK_SECONDS = Math.ceil(CRITICAL_FULLSCREEN_LOCK_MS / 1000);
// Recurring haptic pulse every 4s while locked, per CLAUDE.md "haptic on critical: continuous".
const HAPTIC_PULSE_MS = 4000;

export const CriticalAlert = ({
  visible,
  value,
  direction,
  category = "glucose",
  valueLabel,
  userId,
  onDismiss,
}: CriticalAlertProps): JSX.Element => {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(LOCK_SECONDS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contact = usePriorityContact(userId, visible);
  const contactRef = useRef(contact);
  contactRef.current = contact;
  // Any tap on the alert cancels the 60s auto-dial.
  const [touched, setTouched] = useState(false);

  // Countdown + haptic pulse lifecycle.
  useEffect(() => {
    if (!visible) {
      setSecondsLeft(LOCK_SECONDS);
      return;
    }
    hapticCritical();
    setSecondsLeft(LOCK_SECONDS);

    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    hapticRef.current = setInterval(hapticCritical, HAPTIC_PULSE_MS);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (hapticRef.current) clearInterval(hapticRef.current);
      tickRef.current = null;
      hapticRef.current = null;
    };
  }, [visible]);

  // CLAUDE.md Edge Case #1: 60s without a tap → open the dialer to the
  // priority-1 contact. Opening the dialer places no call by itself.
  useEffect(() => {
    if (!visible) {
      setTouched(false);
      return;
    }
    if (touched) return;
    const timer = setTimeout(() => {
      const target = contactRef.current;
      if (!target) return;
      const tel = sanitizePhoneForTelUri(target.phone);
      if (tel.length === 0) return;
      track("critical_alert_auto_call_triggered", { contact_id: target.id });
      void Linking.openURL(`tel:${tel}`);
    }, CRITICAL_AUTO_DIAL_MS);
    return () => clearTimeout(timer);
  }, [visible, touched]);

  const dismissible = secondsLeft === 0;

  // Block Android hardware back button while the lock is active.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!dismissible) return true; // swallow event
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, dismissible, onDismiss]);

  const copyPrefix = category === "bp" ? "critical.bp" : "critical";
  const copySuffix = direction === "low" ? "Low" : "High";

  const dial = (phone: string): void => {
    const tel = sanitizePhoneForTelUri(phone);
    if (tel.length === 0) return;
    void Linking.openURL(`tel:${tel}`);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      // Prevent OS-level dismiss (Android back, iOS swipe to dismiss n/a here).
      onRequestClose={() => {
        if (dismissible) onDismiss();
      }}
    >
      <View
        className="flex-1 items-center justify-center bg-critical px-6"
        testID="critical-alert-root"
        onTouchStart={() => setTouched(true)}
      >
        <Icon name="warning" size={72} color="#FFFFFF" accessibilityLabel="Critical alert" />
        <Text className="mt-4 text-hero font-bold text-white text-center">
          {t(`${copyPrefix}.alertTitle${copySuffix}`)}
        </Text>
        <Text className="mt-2 text-hero text-white">{valueLabel ?? `${value} mg/dL`}</Text>
        <Text className="mt-4 text-center text-important text-white">
          {t(`${copyPrefix}.alertBody${copySuffix}`)}
        </Text>
        {contact && !touched ? (
          <Text className="mt-4 text-center text-body text-white">
            {t("critical.autoDialHint", { name: contact.name })}
          </Text>
        ) : null}
        <View className="mt-6 w-full gap-3">
          {contact ? (
            <Button
              label={t("critical.callContact", { name: contact.name })}
              variant="primary"
              onPress={() => dial(contact.phone)}
            />
          ) : null}
          <Button
            label={t("critical.callEmergency")}
            variant={contact ? "secondary" : "primary"}
            onPress={() => dial(EMERGENCY_NUMBER)}
          />
          <Button
            label={
              dismissible
                ? t("critical.close")
                : t("critical.waitDismiss", { seconds: secondsLeft })
            }
            variant="ghost"
            disabled={!dismissible}
            onPress={onDismiss}
          />
        </View>
      </View>
    </Modal>
  );
};
