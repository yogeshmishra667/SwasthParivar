// Phase 3 — AI Chat: session list screen (phase3.md M.1).
// Lists the patient's recent chat sessions; a row opens that thread,
// and "new chat" opens an empty thread (the server creates the session
// on the first send).

import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ActiveProfileBadge } from "@/components/profile/ActiveProfileBadge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { listChatSessions, type ChatSessionDto } from "@/services/chat";

export default function ChatListScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSessionDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const res = await listChatSessions({ limit: 30 });
    setSessions(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openThread = (sessionId: string): void => {
    router.push({ pathname: "/chat/[sessionId]", params: { sessionId } });
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between border-b border-gray-200 px-2 py-2">
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t("chat.flagDialog.cancel")}
            className="min-h-touch min-w-touch items-center justify-center"
            hitSlop={8}
          >
            <Icon name="chevron-back" size={24} color="#111827" />
          </Pressable>
          <Text className="text-hero font-bold">{t("chat.title")}</Text>
        </View>
        <ActiveProfileBadge />
      </View>

      <View className="px-4 py-3">
        <Button label={t("chat.newChat")} onPress={() => openThread("new")} />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-body text-neutral">{t("common.loading")}</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Icon name="chatbubbles-outline" size={48} color="#6B7280" />
          <Text className="mt-3 text-center text-important text-neutral">
            {t("chat.emptyState")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerClassName="px-4 pb-6"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openThread(item.id)}
              accessibilityRole="button"
              className="mb-2 min-h-touch flex-row items-center justify-between rounded-2xl bg-white px-4 py-3 active:opacity-80"
            >
              <Text className="text-important text-gray-900">
                {new Date(item.startedAt).toLocaleString()}
              </Text>
              <Icon name="chevron-forward" size={20} color="#6B7280" />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
