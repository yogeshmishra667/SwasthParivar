// Phase 3 — AI Chat: message bubble (phase3.md M.1).
// User messages sit right (brand bg); assistant messages sit left
// (gray bg) and always carry a 🚩 flag button + a cost-tier badge.
//
// `onLongPress` (copy / edit-and-resend) is a power-user shortcut only.
// The design system bans long-press for ESSENTIAL actions — so before
// this is wired, copy/edit must also be reachable via a visible tap
// target (e.g. a "⋯" affordance on the bubble row).

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { FlagButton } from "./FlagButton";
import { CostTierBadge } from "./CostTierBadge";
import type { MessageBubbleProps } from "./types";

// Coarse relative time — minutes/hours, then falls back to a date.
// Chat does not need second precision.
const formatTime = (iso: string, justNow: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return justNow;
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return new Date(iso).toLocaleDateString();
};

export const MessageBubble = ({
  message,
  tier,
  flagged,
  flaggedByUser,
  onFlag,
  onLongPress,
}: MessageBubbleProps): JSX.Element => {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  return (
    <View className={`my-2 px-4 ${isUser ? "items-end" : "items-start"}`}>
      <Pressable
        onLongPress={onLongPress ? () => onLongPress(message.id) : undefined}
        accessibilityRole="text"
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? "rounded-br-md bg-primary" : "rounded-bl-md border border-gray-200 bg-white"
        }`}
      >
        <Text className={`text-important ${isUser ? "text-white" : "text-gray-900"}`}>
          {message.content}
        </Text>
      </Pressable>

      <View className={`mt-1 flex-row items-center gap-1.5 ${isUser ? "pr-1" : "pl-1"}`}>
        {!isUser && tier ? <CostTierBadge tier={tier} /> : null}
        <Text className="text-body text-neutral">
          {formatTime(message.createdAt, t("chat.justNow"))}
        </Text>
        {!isUser ? (
          <FlagButton onPress={() => onFlag(message.id)} flagged={flagged || flaggedByUser} />
        ) : null}
      </View>
    </View>
  );
};
