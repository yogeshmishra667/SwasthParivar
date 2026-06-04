import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ListRenderItemInfo,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/ui/Icon";

// Two-zone editorial card carousel.
//
// Each card splits cleanly into:
//   1. Top zone (tinted accent surface, fixed height): an icon TILE on
//      the left, a large faded NUMBER on the right, and two decorative
//      circle blobs cropped behind both for depth. Asymmetric on
//      purpose — center-stacked layouts read as templated/generic.
//   2. Bottom zone (clean white/dark surface): title (text-hero, bold,
//      left-aligned), 2-3 lines of body, then an action row with an
//      arrow nudge on the right.
//
// One accent color owns each card (icon glyph, number tint, action
// text, arrow). No competing pills, dividers, dots, stripes — the
// two-zone split itself is the rhythm.
//
// Geometry: lives inside the insights ScrollView's 16dp padding, so
// we size against `SCREEN_W - PARENT_PADDING*2` and reserve a small
// peek to signal scrollability.

const SCREEN_W = Dimensions.get("window").width;
const PARENT_PADDING = 16;
const GAP = 14;
const PEEK = 24;
const USABLE_W = SCREEN_W - PARENT_PADDING * 2;
const CARD_W = USABLE_W - PEEK;
const STRIDE = CARD_W + GAP;
const CARD_MIN_HEIGHT = 320;
const HERO_HEIGHT = 132;

interface Tip {
  id: string;
  icon: IconName;
  accent: string;
  /** Tailwind class for the tinted top zone. Soft tint so the white
   *  icon tile and faded number both read against it. */
  topLight: string;
  topDark: string;
  /** Decorative blob tone — slightly stronger than the top zone. */
  blobLight: string;
  blobDark: string;
  title: string;
  desc: string;
  action: string;
}

export const TipsCarousel = (): JSX.Element => {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Tip>>(null);

  const tips: Tip[] = [
    {
      id: "water",
      icon: "water",
      accent: "#0284C7",
      topLight: "bg-sky-100",
      topDark: "dark:bg-sky-950/50",
      blobLight: "bg-sky-200",
      blobDark: "dark:bg-sky-800/40",
      title: t("insights.tips.water.title", { defaultValue: "Stay hydrated" }),
      desc: t("insights.tips.water.desc", {
        defaultValue: "Roz 8 glass pani peene se kidneys extra sugar bahar nikalti hain.",
      }),
      action: t("insights.tips.water.action", { defaultValue: "Aaj 8 glass pani peeyein" }),
    },
    {
      id: "walk",
      icon: "walk",
      accent: "#16A34A",
      topLight: "bg-green-100",
      topDark: "dark:bg-green-950/50",
      blobLight: "bg-green-200",
      blobDark: "dark:bg-green-800/40",
      title: t("insights.tips.walk.title", { defaultValue: "Walk after meals" }),
      desc: t("insights.tips.walk.desc", {
        defaultValue: "Khaane ke baad 10 min walk se sugar spike bahut kam ho jata hai.",
      }),
      action: t("insights.tips.walk.action", { defaultValue: "Aaj 10 min walk karein" }),
    },
    {
      id: "fiber",
      icon: "leaf",
      accent: "#D97706",
      topLight: "bg-amber-100",
      topDark: "dark:bg-amber-950/50",
      blobLight: "bg-amber-200",
      blobDark: "dark:bg-amber-800/40",
      title: t("insights.tips.fiber.title", { defaultValue: "More fiber" }),
      desc: t("insights.tips.fiber.desc", {
        defaultValue: "Sabzi, dal, aur saboot anaaj sugar absorption ko slow karte hain.",
      }),
      action: t("insights.tips.fiber.action", { defaultValue: "Aaj ek sabzi extra lein" }),
    },
    {
      id: "sleep",
      icon: "moon",
      accent: "#7C3AED",
      topLight: "bg-violet-100",
      topDark: "dark:bg-violet-950/50",
      blobLight: "bg-violet-200",
      blobDark: "dark:bg-violet-800/40",
      title: t("insights.tips.sleep.title", { defaultValue: "Sleep 7 hours" }),
      desc: t("insights.tips.sleep.desc", {
        defaultValue: "Achchi neend insulin sensitivity ko sudhaar deti hai.",
      }),
      action: t("insights.tips.sleep.action", { defaultValue: "Aaj jaldi soyein" }),
    },
  ];

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const i = Math.round(e.nativeEvent.contentOffset.x / STRIDE);
      setIndex(Math.max(0, Math.min(tips.length - 1, i)));
    },
    [tips.length],
  );

  const renderItem = ({ item, index: i }: ListRenderItemInfo<Tip>): JSX.Element => {
    const numberLabel = `0${i + 1}`;
    return (
      <View
        style={{
          width: CARD_W,
          minHeight: CARD_MIN_HEIGHT,
          marginRight: i === tips.length - 1 ? 0 : GAP,
        }}
        className="overflow-hidden rounded-3xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900"
      >
        {/* ── Hero zone ─────────────────────────────────────────── */}
        <View
          style={{ height: HERO_HEIGHT }}
          className={`relative overflow-hidden ${item.topLight} ${item.topDark}`}
        >
          {/* Decorative blobs — cropped, off-axis, give the zone
              dimension without dominating it. */}
          <View
            style={{ top: -40, right: -30 }}
            className={`absolute h-40 w-40 rounded-full opacity-70 ${item.blobLight} ${item.blobDark}`}
          />
          <View
            style={{ bottom: -28, right: 60 }}
            className={`absolute h-24 w-24 rounded-full opacity-40 ${item.blobLight} ${item.blobDark}`}
          />

          {/* Big faded number — anchored top-right, the editorial cue */}
          <Text
            className="absolute font-black opacity-25"
            style={{ top: 18, right: 22, fontSize: 56, lineHeight: 56, color: item.accent }}
          >
            {numberLabel}
          </Text>

          {/* Icon tile — anchored bottom-left so it spans the seam
              between hero and content, giving a sense of layering. */}
          <View
            style={{ bottom: -18, left: 20 }}
            className="absolute h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-gray-800"
          >
            <Icon name={item.icon} size={30} color={item.accent} />
          </View>
        </View>

        {/* ── Content zone ──────────────────────────────────────── */}
        <View className="flex-1 px-6 pb-5 pt-7">
          <Text className="text-hero font-bold text-gray-900 dark:text-gray-100" numberOfLines={1}>
            {item.title}
          </Text>
          <Text
            className="mt-2 text-body leading-5 text-gray-600 dark:text-gray-400"
            numberOfLines={3}
          >
            {item.desc}
          </Text>

          {/* Spacer pushes the action row to the bottom of the card so
              all cards align their footers regardless of body length. */}
          <View className="flex-1" />

          {/* Action row — leading topic icon (replaces the old emoji),
              action text, trailing circular arrow nudge. The leading
              icon repeats the tip's identity so the action reads as
              "this tip → do this today" at a glance. */}
          <View className="mt-4 flex-row items-center gap-2.5">
            <View
              className="h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: `${item.accent}1A` }}
            >
              <Icon name={item.icon} size={14} color={item.accent} />
            </View>
            <Text
              className="flex-1 text-body font-bold"
              style={{ color: item.accent }}
              numberOfLines={1}
            >
              {item.action}
            </Text>
            <View
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: item.accent }}
            >
              <Icon name="arrow-forward" size={16} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="mt-1">
      <Text className="mb-3 text-important font-bold text-gray-900 dark:text-gray-100">
        {t("insights.tips.header", { defaultValue: "Daily health tips" })}
      </Text>

      <FlatList
        ref={listRef}
        data={tips}
        horizontal
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={STRIDE}
        snapToAlignment="start"
        onScroll={onScroll}
        scrollEventThrottle={16}
      />

      <View className="mt-3 flex-row items-center justify-center gap-1.5">
        {tips.map((tip, i) => {
          const active = i === index;
          return (
            <View
              key={tip.id}
              className={`h-1.5 rounded-full ${
                active ? "bg-gray-800 dark:bg-gray-200" : "bg-gray-300 dark:bg-gray-700"
              }`}
              style={{ width: active ? 22 : 6 }}
            />
          );
        })}
      </View>
    </View>
  );
};
