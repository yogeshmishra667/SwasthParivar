import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Linking, BackHandler, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { CRITICAL_AUTO_DIAL_MS, CRITICAL_FULLSCREEN_LOCK_MS } from "@/utils/constants";
import { isDialablePhone, sanitizePhoneForTelUri } from "@/utils/phone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { hapticCritical } from "@/utils/haptics";
import { logError, track } from "@/services/analytics";
import { usePriorityContact } from "@/hooks/usePriorityContact";

const EMERGENCY_NUMBER = "112";
const AUTO_DIAL_SECONDS = Math.round(CRITICAL_AUTO_DIAL_MS / 1000);

// High contrast on the red background (elderly users): white call
// buttons with dark-red text, white outlines, and the hint on a dark-red
// panel (white on #7F1D1D ≈ 10:1).
const DARK_RED = "#7F1D1D";
const FILLED = { backgroundColor: "#FFFFFF", minHeight: 60 } as const;
const FILLED_TEXT = { color: DARK_RED, fontSize: 20, fontWeight: "700" } as const;
const OUTLINED = {
  backgroundColor: "transparent",
  borderColor: "#FFFFFF",
  borderWidth: 3,
  minHeight: 56,
} as const;
const OUTLINED_TEXT = { color: "#FFFFFF", fontSize: 18, fontWeight: "700" } as const;
// Reserved for the longest hint (Hindi, large text), so nothing moves
// under the user's finger when the hint changes on the first touch.
const HINT_AREA = { minHeight: 120 } as const;

const openDialer = (phone: string): void => {
  const tel = sanitizePhoneForTelUri(phone);
  if (tel.length === 0) return;
  Linking.openURL(`tel:${tel}`).catch((err: unknown) => logError("criticalAlert.dial", err));
};

interface CriticalAlertProps {
  visible: boolean;
  /**
   * Changes for every new alert while the modal stays up (e.g. a newer
   * reading): the lock, the touch state and the auto-dial start over.
   */
  alertKey?: number;
  /** Glucose mg/dL, shown as "<value> mg/dL" when there is no `valueLabel`. */
  value?: number;
  /** glucose / bp. */
  direction?: "low" | "high";
  /** Picks the copy. Defaults to glucose (the Phase 1 alert). */
  category?: "glucose" | "bp" | "cardiac" | "respiratory";
  /** cardiac / respiratory copy, e.g. "hr_low" (see `criticalReasonKey`). */
  reasonKey?: string;
  /** Reading as shown, e.g. "190/120 mmHg". Defaults to "<value> mg/dL". */
  valueLabel?: string;
  /**
   * "guardian": a family member's phone, alerted by push about their
   * patient. No dismiss lock and no auto-dial; it can open the patient's
   * details. Defaults to "patient".
   */
  audience?: "patient" | "guardian";
  /** Overrides the copy, e.g. a push's own localised title and body. */
  title?: string;
  body?: string;
  /** Guardian: opens the patient's details. */
  onOpenDetails?: () => void;
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
  alertKey = 0,
  value,
  direction = "low",
  category = "glucose",
  reasonKey,
  valueLabel,
  audience = "patient",
  title,
  body,
  onOpenDetails,
  userId,
  onDismiss,
}: CriticalAlertProps): JSX.Element => {
  const { t } = useTranslation();
  // The patient can't dismiss for 30s; a guardian alert can be closed at once.
  const lockSeconds = audience === "guardian" ? 0 : LOCK_SECONDS;
  const [secondsLeft, setSecondsLeft] = useState(lockSeconds);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const found = usePriorityContact(userId, visible);
  const contact = found && isDialablePhone(found.phone) ? found : null;
  const contactRef = useRef(contact);
  contactRef.current = contact;
  // Any tap on the alert cancels the 60s auto-dial.
  const [touched, setTouched] = useState(false);
  const onTouch = (): void => {
    if (touched) return;
    setTouched(true);
    if (contactRef.current) track("critical_alert_autodial_cancelled");
  };

  // Countdown + haptic pulse lifecycle.
  useEffect(() => {
    if (!visible) {
      setSecondsLeft(lockSeconds);
      return;
    }
    hapticCritical();
    setSecondsLeft(lockSeconds);

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
  }, [visible, lockSeconds, alertKey]);

  // A new alert starts untouched, so its own auto-dial runs.
  useEffect(() => {
    setTouched(false);
  }, [alertKey]);

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
      track("critical_alert_auto_call_triggered", { contact_id: target.id });
      openDialer(target.phone);
    }, CRITICAL_AUTO_DIAL_MS);
    return () => clearTimeout(timer);
  }, [visible, touched, alertKey]);

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

  const copy = ((): { title: string; body: string } => {
    if (title !== undefined && body !== undefined) return { title, body };
    if (category === "cardiac" || category === "respiratory") {
      const key = reasonKey ?? "generic";
      return {
        title: t(`critical.${category}.title.${key}`),
        body: t(`critical.${category}.body.${key}`),
      };
    }
    const prefix = category === "bp" ? "critical.bp" : "critical";
    const suffix = direction === "low" ? "Low" : "High";
    return { title: t(`${prefix}.alertTitle${suffix}`), body: t(`${prefix}.alertBody${suffix}`) };
  })();
  const shownValue = valueLabel ?? (value !== undefined ? `${value} mg/dL` : null);

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
      <View className="flex-1 bg-critical" testID="critical-alert-root" onTouchStart={onTouch}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
          className="px-6"
        >
          <Icon name="warning" size={72} color="#FFFFFF" accessibilityLabel="Critical alert" />
          <Text className="mt-4 text-hero font-bold text-white text-center">{copy.title}</Text>
          {shownValue !== null ? (
            <Text className="mt-2 text-hero text-white">{shownValue}</Text>
          ) : null}
          <Text className="mt-4 text-center text-important text-white">{copy.body}</Text>
          <View className="mt-4 w-full justify-center" style={contact ? HINT_AREA : undefined}>
            {contact ? (
              <View className="rounded-xl px-4 py-2" style={{ backgroundColor: DARK_RED }}>
                <Text className="text-center text-important font-semibold text-white">
                  {touched
                    ? t("critical.autoDialOff")
                    : t("critical.autoDialHint", {
                        name: contact.name,
                        seconds: AUTO_DIAL_SECONDS,
                      })}
                </Text>
              </View>
            ) : null}
          </View>
          <View className="mt-4 w-full gap-3">
            {onOpenDetails ? (
              <Button
                label={t("critical.openDetails")}
                style={FILLED}
                textStyle={FILLED_TEXT}
                onPress={onOpenDetails}
              />
            ) : null}
            {contact ? (
              <Button
                label={t("critical.callContact", { name: contact.name })}
                style={FILLED}
                textStyle={FILLED_TEXT}
                onPress={() => openDialer(contact.phone)}
              />
            ) : null}
            <Button
              label={t("critical.callEmergency")}
              style={contact || onOpenDetails ? OUTLINED : FILLED}
              textStyle={contact || onOpenDetails ? OUTLINED_TEXT : FILLED_TEXT}
              onPress={() => openDialer(EMERGENCY_NUMBER)}
            />
            <Button
              label={
                dismissible
                  ? t("critical.close")
                  : t("critical.waitDismiss", { seconds: secondsLeft })
              }
              variant="ghost"
              style={{ borderColor: "#FFFFFF", borderWidth: 2 }}
              textStyle={{ color: "#FFFFFF" }}
              disabled={!dismissible}
              onPress={onDismiss}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};
