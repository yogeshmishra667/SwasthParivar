// Phase 2 — Meal quick-log surface. Two-step tap-only flow:
//   1. Meal type (Nashta / Dopahar / Raat / Snack) — auto-selected
//      from clock when first opened, but always overridable.
//   2. Category (Halka / Normal / Bhaari) — single tap saves.
//
// Total taps: 2 (1 if the auto-detected type is correct). Matches the
// "<3 taps" rule from CLAUDE.md.

import { useState, useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import type { MealCategory, MealType } from "@swasth/shared-types";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface MealQuickLogProps {
  onSave: (params: { mealType: MealType; mealCategory: MealCategory }) => void;
  saving?: boolean;
}

const TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"] as const;
const CATEGORIES: readonly MealCategory[] = ["light", "normal", "heavy_fried"] as const;

const CATEGORY_EMOJI: Record<MealCategory, string> = {
  light: "🥗",
  normal: "🍛",
  heavy_fried: "🍟",
};

const CATEGORY_COLOR: Record<MealCategory, string> = {
  light: "bg-green-50 border-green-600",
  normal: "bg-blue-50 border-blue-600",
  heavy_fried: "bg-amber-50 border-amber-600",
};

// Map current local hour to a default meal type — saves a tap on most
// logs. Boundaries match CLAUDE.md "Patch #8 time windows" loosely:
// breakfast 5-10, lunch 11-15, snack 16-18, dinner 19-23.
const inferMealType = (date: Date = new Date()): MealType => {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 19) return "snack";
  return "dinner";
};

export const MealQuickLog = ({ onSave, saving = false }: MealQuickLogProps): JSX.Element => {
  const { t } = useTranslation();
  const [mealType, setMealType] = useState<MealType>(() => inferMealType());

  const typeLabels = useMemo<Record<MealType, string>>(
    () => ({
      breakfast: t("meals.type.breakfast"),
      lunch: t("meals.type.lunch"),
      dinner: t("meals.type.dinner"),
      snack: t("meals.type.snack"),
    }),
    [t],
  );

  const categoryLabel = (c: MealCategory): string =>
    c === "light" ? t("meals.light") : c === "normal" ? t("meals.normal") : t("meals.heavy");

  const categoryHint = (c: MealCategory): string =>
    c === "light"
      ? t("meals.lightHint")
      : c === "normal"
        ? t("meals.normalHint")
        : t("meals.heavy") + " — " + t("meals.heavyHint");

  return (
    <View className="gap-4">
      <View>
        <Text className="text-hero font-bold">{t("meals.title")}</Text>
        <Text className="mt-1 text-body text-neutral">{t("meals.subtitle")}</Text>
      </View>

      <Card>
        <View className="flex-row flex-wrap gap-2">
          {TYPES.map((tp) => {
            const active = mealType === tp;
            return (
              <Pressable
                key={tp}
                onPress={() => setMealType(tp)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={{ minHeight: TOUCH_TARGET_MIN }}
                className={`flex-1 items-center justify-center rounded-xl border-2 px-3 py-2 ${
                  active ? "border-primary bg-blue-50" : "border-gray-200 bg-white"
                }`}
              >
                <Text
                  className={`text-important font-semibold ${
                    active ? "text-blue-700" : "text-gray-900"
                  }`}
                >
                  {typeLabels[tp]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <View className="gap-3">
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => !saving && onSave({ mealType, mealCategory: cat })}
            accessibilityRole="button"
            accessibilityLabel={`${categoryLabel(cat)} — ${categoryHint(cat)}`}
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            style={{ minHeight: TOUCH_TARGET_MIN + 24 }}
            className={`flex-row items-center gap-4 rounded-2xl border-2 p-4 ${CATEGORY_COLOR[cat]} ${
              saving ? "opacity-60" : ""
            }`}
          >
            <Text className="text-4xl">{CATEGORY_EMOJI[cat]}</Text>
            <View className="flex-1">
              <Text className="text-important font-bold text-gray-900">{categoryLabel(cat)}</Text>
              <Text className="mt-0.5 text-body text-neutral">{categoryHint(cat)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
};
