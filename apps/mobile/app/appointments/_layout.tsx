// Phase 4 §G mobile — doctor-portal stack. `index` = upcoming list,
// `new` = create flow, `[id]` = detail + pre-visit report. Each screen
// draws its own header.
import { Stack } from "expo-router";

export default function AppointmentsLayout(): JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
