// Phase 3 Feature C — Silent Guardian alert card.
//
// One card on GuardianHome (a patient's latest state) or in the alert
// history list. Severity drives the colour + emoji; the headline / body
// strings are the server-generated alert copy (never assembled here).
// Whole card is the 48dp tap target when `onPress` is given.

import { View, Text, Pressable } from "react-native";
import { Icon } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export type AlertCardSeverity = "safe" | "yellow" | "orange";

interface AlertCardProps {
  severity: AlertCardSeverity;
  patientName: string;
  // `| undefined` is explicit so callers can pass a conditionally-absent
  // value under the workspace's exactOptionalPropertyTypes setting.
  relationship?: string | null | undefined;
  severityLabel?: string | undefined;
  headline: string;
  body?: string | undefined;
  timeLabel?: string | undefined;
  unread?: boolean | undefined;
  ctaLabel?: string | undefined;
  onPress?: (() => void) | undefined;
}

const SEVERITY_STYLE: Record<AlertCardSeverity, { emoji: string; border: string; accent: string }> =
  {
    orange: { emoji: "🟠", border: "border-warning", accent: "text-warning" },
    yellow: { emoji: "🟡", border: "border-amber-400", accent: "text-amber-700" },
    safe: { emoji: "✅", border: "border-success", accent: "text-success" },
  };

export const AlertCard = ({
  severity,
  patientName,
  relationship,
  severityLabel,
  headline,
  body,
  timeLabel,
  unread,
  ctaLabel,
  onPress,
}: AlertCardProps): JSX.Element => {
  const style = SEVERITY_STYLE[severity];

  const inner = (
    <View className={`rounded-2xl border border-l-4 border-gray-200 ${style.border} bg-white p-4`}>
      <View className="flex-row items-center gap-2">
        <Text className="text-important">{style.emoji}</Text>
        <Text className="flex-1 text-important font-semibold text-gray-900">
          {relationship ? `${patientName} — ${relationship}` : patientName}
        </Text>
        {unread ? (
          <View
            className="h-3 w-3 rounded-full bg-primary"
            accessibilityLabel="unread"
            accessibilityRole="image"
          />
        ) : null}
      </View>

      {severityLabel ? (
        <Text className={`mt-1 text-body font-semibold ${style.accent}`}>{severityLabel}</Text>
      ) : null}

      <Text className="mt-1 text-important font-semibold text-gray-900">{headline}</Text>
      {body ? <Text className="mt-1 text-body text-gray-700">{body}</Text> : null}
      {timeLabel ? <Text className="mt-1 text-body text-neutral">{timeLabel}</Text> : null}

      {ctaLabel && onPress ? (
        <View className="mt-3 flex-row items-center gap-1">
          <Text className="text-body font-semibold text-primary">{ctaLabel}</Text>
          <Icon name="chevron-forward" size={16} color="#2563EB" />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${patientName}: ${headline}`}
      style={{ minHeight: TOUCH_TARGET_MIN }}
      className="active:opacity-80"
    >
      {inner}
    </Pressable>
  );
};
