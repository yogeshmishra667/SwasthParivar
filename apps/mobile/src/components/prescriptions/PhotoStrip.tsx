// Phase 4 §F.13 — one labelled photo strip (prescription pages OR medicine
// packets). Shows thumbnails + a count badge + an add tile that opens the
// camera, and a clear-all when non-empty. Capped at `max`.

import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/ui/Icon";

interface Props {
  label: string;
  hint: string;
  uris: string[];
  max: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

export const PhotoStrip = ({
  label,
  hint,
  uris,
  max,
  onAdd,
  onRemove,
  onClear,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const atMax = uris.length >= max;

  return (
    <View className="mb-5">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-important font-semibold text-gray-900 dark:text-gray-100">
          {label}
        </Text>
        {uris.length > 0 ? (
          <View className="flex-row items-center">
            <View className="mr-3 rounded-full bg-blue-50 px-3 py-1 dark:bg-blue-900/40">
              <Text className="text-body font-semibold text-blue-700 dark:text-blue-300">
                {t("prescriptions.upload.count", { count: uris.length })}
              </Text>
            </View>
            <Pressable
              onPress={onClear}
              accessibilityRole="button"
              className="px-2 py-2"
              style={{ minHeight: 44 }}
            >
              <Text className="text-body text-critical">{t("prescriptions.upload.clearAll")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <Text className="mb-3 text-body text-gray-500 dark:text-gray-400">{hint}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {uris.map((uri, i) => (
          <View key={`${uri}-${i}`} className="mr-3">
            <Image
              source={{ uri }}
              style={{ width: 96, height: 96, borderRadius: 12 }}
              accessibilityIgnoresInvertColors
            />
            <Pressable
              onPress={() => onRemove(i)}
              accessibilityRole="button"
              accessibilityLabel={t("prescriptions.upload.clearAll")}
              className="absolute -right-2 -top-2 items-center justify-center rounded-full bg-critical"
              style={{ width: 28, height: 28 }}
            >
              <Icon name="close" size={16} color="#fff" />
            </Pressable>
          </View>
        ))}

        {!atMax ? (
          <Pressable
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel={t("prescriptions.upload.addPhoto")}
            className="items-center justify-center rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700"
            style={{ width: 96, height: 96 }}
          >
            <Icon name="camera" size={28} color="#6B7280" />
            <Text className="mt-1 text-center text-body text-gray-500">
              {t("prescriptions.upload.addPhoto")}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
};
