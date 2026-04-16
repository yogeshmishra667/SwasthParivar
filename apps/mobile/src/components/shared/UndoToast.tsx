import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { TIMEOUTS } from "@/utils/constants";

interface Props {
  visible: boolean;
  message: string;
  onUndo: () => void;
  onHide: () => void;
}

export const UndoToast = ({ visible, message, onUndo, onHide }: Props): JSX.Element | null => {
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    setShown(true);
    const id = setTimeout(() => {
      setShown(false);
      onHide();
    }, TIMEOUTS.undoToastMs);
    return () => clearTimeout(id);
  }, [visible, onHide]);

  if (!shown) return null;

  return (
    <View className="absolute bottom-8 left-4 right-4 flex-row items-center justify-between rounded-2xl bg-gray-800 px-4 py-3">
      <Text className="text-important text-white">{message}</Text>
      <Pressable onPress={onUndo} accessibilityRole="button" className="px-3 py-1">
        <Text className="text-important font-bold text-streak">Undo</Text>
      </Pressable>
    </View>
  );
};
