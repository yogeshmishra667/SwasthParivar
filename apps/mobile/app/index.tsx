import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth.store";

export default function Index(): JSX.Element | null {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!hydrated) void useAuthStore.getState().hydrate();
  }, [hydrated]);

  if (!hydrated) return null;
  return <Redirect href={token ? "/(tabs)/dashboard" : "/(auth)/login"} />;
}
