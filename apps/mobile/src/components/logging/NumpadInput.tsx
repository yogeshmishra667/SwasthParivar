import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface NumpadProps {
  onSubmit: (value: number) => void;
  initialValue?: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

export const NumpadInput = ({ onSubmit, initialValue = "" }: NumpadProps): JSX.Element => {
  const [buffer, setBuffer] = useState(initialValue);

  const handlePress = (key: string): void => {
    if (key === "C") {
      setBuffer("");
      return;
    }
    if (key === "⌫") {
      setBuffer((b) => b.slice(0, -1));
      return;
    }
    if (buffer.length >= 3) return;
    setBuffer((b) => b + key);
  };

  const numeric = Number.parseInt(buffer, 10);
  const canSubmit = Number.isFinite(numeric) && numeric >= 20 && numeric <= 600;

  return (
    <View className="gap-3">
      <View className="items-center rounded-2xl bg-white p-4">
        <Text className="text-hero font-bold">{buffer || "—"}</Text>
        <Text className="text-body text-neutral">mg/dL</Text>
      </View>

      <View className="flex-row flex-wrap justify-between">
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => handlePress(k)}
            accessibilityRole="button"
            accessibilityLabel={`Numpad ${k}`}
            className="mb-2 w-[31%] items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200"
            style={{ minHeight: TOUCH_TARGET_MIN + 16 }}
          >
            <Text className="text-number font-semibold">{k}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={!canSubmit}
        onPress={() => onSubmit(numeric)}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        className={`items-center justify-center rounded-2xl px-5 ${
          canSubmit ? "bg-primary" : "bg-gray-300"
        }`}
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <Text className="text-important font-bold text-white">Agay badhein</Text>
      </Pressable>
    </View>
  );
};
