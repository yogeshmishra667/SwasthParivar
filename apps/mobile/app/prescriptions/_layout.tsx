// Phase 4 §F.13 — prescription stack. `upload` = capture screen,
// `[id]` = approver / patient detail. Each screen draws its own header.
import { Stack } from "expo-router";

export default function PrescriptionsLayout(): JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
