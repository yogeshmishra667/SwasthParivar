import { useEffect, useState } from "react";
import { Modal, View, Text, Linking } from "react-native";
import { CRITICAL_FULLSCREEN_LOCK_MS } from "@/utils/constants";
import { Button } from "@/components/ui/Button";
import { hapticCritical } from "@/utils/haptics";

interface CriticalAlertProps {
  visible: boolean;
  value: number;
  direction: "low" | "high";
  contactName: string;
  contactPhone: string;
  onDismiss: () => void;
}

export const CriticalAlert = ({
  visible,
  value,
  direction,
  contactName,
  contactPhone,
  onDismiss,
}: CriticalAlertProps): JSX.Element => {
  const [dismissible, setDismissible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setDismissible(false);
      return;
    }
    hapticCritical();
    const id = setTimeout(() => setDismissible(true), CRITICAL_FULLSCREEN_LOCK_MS);
    return () => clearTimeout(id);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View className="flex-1 items-center justify-center bg-critical px-6">
        <Text className="text-6xl">⚠️</Text>
        <Text className="mt-4 text-hero font-bold text-white">
          Sugar bahut {direction === "low" ? "kam" : "zyada"}
        </Text>
        <Text className="mt-2 text-hero text-white">{value} mg/dL</Text>
        <Text className="mt-4 text-center text-important text-white">
          {direction === "low"
            ? "Abhi kuch meetha khayein — juice, glucose, mithai."
            : "Paani peeyein. Dawai li hai check karein."}
        </Text>
        <View className="mt-6 w-full gap-3">
          <Button
            label={`📞 ${contactName} ko call karein`}
            variant="primary"
            onPress={() => void Linking.openURL(`tel:${contactPhone}`)}
          />
          <Button
            label={dismissible ? "Close" : "Wait 30s..."}
            variant="ghost"
            disabled={!dismissible}
            onPress={onDismiss}
          />
        </View>
      </View>
    </Modal>
  );
};
