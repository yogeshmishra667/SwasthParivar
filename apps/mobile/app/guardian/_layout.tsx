// Phase 3 Feature C — Silent Guardian navigation stack (phase3.md M.3).
// `index` = GuardianHome, `alert/[alertId]` = AlertDetail,
// `history` = AlertHistory. Each screen draws its own header.

import { Stack } from "expo-router";

export default function GuardianLayout(): JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
