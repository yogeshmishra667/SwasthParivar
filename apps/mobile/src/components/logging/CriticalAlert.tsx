import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Linking, BackHandler } from "react-native";
import { CRITICAL_FULLSCREEN_LOCK_MS } from "@/utils/constants";
import { sanitizePhoneForTelUri } from "@/utils/phone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { hapticCritical } from "@/utils/haptics";

interface CriticalAlertProps {
  visible: boolean;
  value: number;
  direction: "low" | "high";
  contactName: string;
  contactPhone: string;
  onDismiss: () => void;
}

const LOCK_SECONDS = Math.ceil(CRITICAL_FULLSCREEN_LOCK_MS / 1000);
// Recurring haptic pulse every 4s while locked, per CLAUDE.md "haptic on critical: continuous".
const HAPTIC_PULSE_MS = 4000;

export const CriticalAlert = ({
  visible,
  value,
  direction,
  contactName,
  contactPhone,
  onDismiss,
}: CriticalAlertProps): JSX.Element => {
  const [secondsLeft, setSecondsLeft] = useState(LOCK_SECONDS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleCall = (): void => {
    const tel = sanitizePhoneForTelUri(contactPhone);
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
      <View className="flex-1 items-center justify-center bg-critical px-6">
        <Icon name="warning" size={72} color="#FFFFFF" accessibilityLabel="Critical alert" />
        <Text className="mt-4 text-hero font-bold text-white text-center">
          Sugar bahut {direction === "low" ? "kam" : "zyada"}
        </Text>
        <Text className="mt-2 text-hero text-white">{value} mg/dL</Text>
        <Text className="mt-4 text-center text-important text-white">
          {direction === "low"
            ? "Abhi kuch meetha khayein — juice, glucose, mithai."
            : "Paani peeyein. Dawai li hai check karein."}
        </Text>
        <View className="mt-6 w-full gap-3">
          <Button label={`${contactName} ko call karein`} variant="primary" onPress={handleCall} />
          <Button
            label={dismissible ? "Close" : `Wait ${secondsLeft}s...`}
            variant="ghost"
            disabled={!dismissible}
            onPress={onDismiss}
          />
        </View>
      </View>
    </Modal>
  );
};
