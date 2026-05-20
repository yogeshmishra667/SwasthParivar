// Phase 3 — AI Chat: thread screen (phase3.md M.1).
//
// Composes the M.1 chat components into a working thread: loads
// history for an existing session, sends turns through the chat
// service, and surfaces the flag dialog. Online-only — the offline
// banner makes that explicit (the WatermelonDB offline send-queue is a
// later sub-slice).
//
// `sessionId` route param is the real session id, or the sentinel
// "new" for a fresh thread (the server mints the session on first send).

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Icon } from "@/components/ui/Icon";
import { AIDisclaimerBanner } from "@/components/chat/AIDisclaimerBanner";
import { OfflineChatBanner } from "@/components/chat/OfflineChatBanner";
import { EmergencyChatGuard } from "@/components/chat/EmergencyChatGuard";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInputBar } from "@/components/chat/ChatInputBar";
import { ChatFlagDialog } from "@/components/chat/ChatFlagDialog";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import {
  sendChatMessage,
  listSessionMessages,
  flagChatMessage,
  type ChatMessageDto,
  type ChatFlagReason,
  type ChatSendErrorCode,
} from "@/services/chat";

// Free-tier daily chat allowance (server-enforced; mirrored here only
// to drive the input-bar rate-limit state).
const FREE_DAILY_LIMIT = 3;

export default function ChatThreadScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId: string }>();
  const { isOffline } = useOfflineStatus();

  const initialSessionId = params.sessionId === "new" ? null : (params.sessionId ?? null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [typing, setTyping] = useState(false);
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState(FREE_DAILY_LIMIT);
  const [flagTarget, setFlagTarget] = useState<string | null>(null);
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialSessionId === null) return;
    void (async () => {
      setMessages(await listSessionMessages(initialSessionId));
    })();
  }, [initialSessionId]);

  const errorCopy = (code: ChatSendErrorCode): string => {
    switch (code) {
      case "CHAT_RATE_LIMITED":
        return t("chat.rateLimit");
      case "CHAT_DISABLED":
      case "CHAT_CIRCUIT_OPEN":
        return t("chat.unavailable");
      case "CHAT_UPSTREAM_TIMEOUT":
        return t("chat.typingTimeout");
      default:
        return t("chat.loadError");
    }
  };

  const deliver = useCallback(
    async (text: string): Promise<void> => {
      lastMessageRef.current = text;
      // Optimistic user bubble — replaced by the server copy on the
      // next full load; the local id never collides with a server id.
      const optimistic: ChatMessageDto = {
        id: `local-${uuidv4()}`,
        sessionId: sessionId ?? "pending",
        role: "user",
        content: text,
        costTier: "template",
        flagged: false,
        flagReason: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setTyping(true);

      const outcome = await sendChatMessage({
        clientUuid: uuidv4(),
        version: 1,
        ...(sessionId ? { sessionId } : {}),
        message: text,
      });
      setTyping(false);

      if (!outcome.ok) {
        if (outcome.code === "CHAT_RATE_LIMITED") setDailyRemaining(0);
        Alert.alert(t("chat.title"), errorCopy(outcome.code));
        return;
      }

      const r = outcome.result;
      setSessionId(r.sessionId);
      setDailyRemaining((n) => Math.max(0, n - 1));
      setMessages((prev) => [
        ...prev,
        {
          id: r.messageId,
          sessionId: r.sessionId,
          role: "assistant",
          content: r.content,
          costTier: r.tier,
          flagged: r.flagged,
          flagReason: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, t],
  );

  const handleRetry = (): void => {
    setTyping(false);
    if (lastMessageRef.current !== null) void deliver(lastMessageRef.current);
  };

  const submitFlag = async (reason: ChatFlagReason, note?: string): Promise<void> => {
    const target = flagTarget;
    setFlagTarget(null);
    if (target === null) return;
    const ok = await flagChatMessage(target, reason, note);
    if (ok) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target ? { ...m, flagged: true, flagReason: "user_flagged" } : m,
        ),
      );
      Alert.alert(t("chat.title"), t("chat.flagConfirm"));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* criticalBypassActive is false until a global critical-bypass
          state store exists on mobile (follow-up). This guard is
          defense-in-depth — the server already enforces emergency-skip
          in chat.service (the canned redirect is returned regardless). */}
      <EmergencyChatGuard criticalBypassActive={false} onResolveCritical={() => router.back()}>
        <View className="flex-row items-center justify-between border-b border-gray-200 px-2 py-2">
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("chat.back")}
              className="min-h-touch min-w-touch items-center justify-center"
              hitSlop={8}
            >
              <Icon name="chevron-back" size={24} color="#111827" />
            </Pressable>
            <Text className="text-important font-bold text-gray-900">{t("chat.title")}</Text>
          </View>
          <ActiveProfileBadge />
        </View>

        {disclaimerDismissed ? null : (
          <AIDisclaimerBanner onDismiss={() => setDisclaimerDismissed(true)} />
        )}
        <OfflineChatBanner isOffline={isOffline} />

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1">
            <MessageList
              messages={messages}
              typing={typing}
              onReachTop={() => undefined}
              onFlag={(id) => setFlagTarget(id)}
              onRetry={handleRetry}
            />
          </View>
          <ChatInputBar
            onSend={deliver}
            disabled={typing}
            dailyRemaining={dailyRemaining}
            isOffline={isOffline}
          />
        </KeyboardAvoidingView>

        <ChatFlagDialog
          visible={flagTarget !== null}
          onClose={() => setFlagTarget(null)}
          onSubmit={(reason, note) => void submitFlag(reason, note)}
        />
      </EmergencyChatGuard>
    </SafeAreaView>
  );
}
