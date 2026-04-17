import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth.store";
import { useProfileStore } from "@/stores/profile.store";
import { api } from "@/services/api";
import { logError } from "@/services/analytics";

type Route =
  | "/(auth)/login"
  | "/(onboarding)/language"
  | "/(onboarding)/condition"
  | "/(onboarding)/profile"
  | "/(onboarding)/first-reading"
  | "/(onboarding)/medications"
  | "/(tabs)/dashboard";

const ONBOARDING_ROUTES: Record<number, Route> = {
  0: "/(onboarding)/language",
  1: "/(onboarding)/condition",
  2: "/(onboarding)/profile",
  3: "/(onboarding)/first-reading",
  4: "/(onboarding)/medications",
};

const AVATAR_COLORS = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#8B5CF6"];

interface HouseholdProfile {
  id: string;
  name: string;
  age: number;
  conditions: string[];
}

interface UserMeResponse {
  success: boolean;
  data: {
    onboardingComplete: boolean;
    onboardingStep: number;
    householdId: string;
    householdProfiles: HouseholdProfile[];
  };
}

export default function Index(): JSX.Element | null {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.accessToken);
  const setHousehold = useProfileStore((s) => s.setHousehold);
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    if (!hydrated) {
      void useAuthStore.getState().hydrate();
      return;
    }
    if (!token) {
      setRoute("/(auth)/login");
      return;
    }
    void (async () => {
      try {
        const res = await api.get<UserMeResponse>("/users/me");
        const { onboardingComplete, onboardingStep, householdId, householdProfiles } = res.data;

        setHousehold(
          householdId,
          householdProfiles.map((p, i) => ({
            id: p.id,
            name: p.name || "User",
            avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? "#6B7280",
            conditions: p.conditions,
          })),
        );

        if (onboardingComplete) {
          setRoute("/(tabs)/dashboard");
        } else {
          setRoute(ONBOARDING_ROUTES[onboardingStep] ?? "/(onboarding)/language");
        }
      } catch (e) {
        logError("index", e);
        setRoute("/(tabs)/dashboard");
      }
    })();
  }, [hydrated, token, setHousehold]);

  if (!hydrated || route === null) return null;
  return <Redirect href={route} />;
}
