// Phase 3 — AI Chat: message list (phase3.md M.1).
//
// Renders the thread as a FlatList of MessageBubble rows with the
// TypingIndicator pinned as the footer. Messages are chronological
// (oldest first); scrolling near the top calls `onReachTop` so the
// screen can lazy-load older history.

import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import type { ChatMessageDto } from "@/services/chat";

interface MessageListProps {
  messages: ChatMessageDto[];
  typing: boolean;
  onReachTop: () => void;
  onFlag: (messageId: string) => void;
  onRetry: () => void;
}

const TOP_THRESHOLD_PX = 24;

const isUserOrAssistant = (role: string): role is "user" | "assistant" =>
  role === "user" || role === "assistant";

export const MessageList = ({
  messages,
  typing,
  onReachTop,
  onFlag,
  onRetry,
}: MessageListProps): JSX.Element => {
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (e.nativeEvent.contentOffset.y <= TOP_THRESHOLD_PX) onReachTop();
  };

  return (
    <FlatList
      data={messages}
      keyExtractor={(m) => m.id}
      onScroll={handleScroll}
      scrollEventThrottle={250}
      renderItem={({ item }) => {
        if (!isUserOrAssistant(item.role)) return null;
        // `tier` is omitted (not set to undefined) for user messages —
        // exactOptionalPropertyTypes forbids an explicit undefined.
        return (
          <MessageBubble
            message={{
              id: item.id,
              content: item.content,
              role: item.role,
              createdAt: item.createdAt,
            }}
            {...(item.role === "assistant" ? { tier: item.costTier } : {})}
            flagged={item.flagged}
            flaggedByUser={item.flagReason?.startsWith("user_flagged") ?? false}
            onFlag={onFlag}
          />
        );
      }}
      ListFooterComponent={<TypingIndicator visible={typing} onRetry={onRetry} />}
      contentContainerClassName="py-2"
    />
  );
};
