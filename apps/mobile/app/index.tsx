import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth.store";

export default function Index(): JSX.Element {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!hydrated) void useAuthStore.getState().hydrate();
  }, [hydrated]);

  if (!hydrated) return <Redirect href="/(auth)/login" />;
  return <Redirect href={token ? "/(tabs)/dashboard" : "/(auth)/login"} />;
}
