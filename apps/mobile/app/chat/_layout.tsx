// Phase 3 — AI Chat navigation stack (phase3.md M.1).
// `index` = session list, `[sessionId]` = a single thread. Each screen
// draws its own header, so the native header stays hidden.

import { Stack } from "expo-router";

export default function ChatLayout(): JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
