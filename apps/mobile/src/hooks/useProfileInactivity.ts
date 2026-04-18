import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useProfileStore } from "@/stores/profile.store";
import { TIMEOUTS } from "@/utils/constants";

export const useProfileInactivity = (): void => {
  useEffect(() => {
    const handleChange = (status: AppStateStatus): void => {
      const { lastActiveAt, profiles, markActive, requestSelector } =
        useProfileStore.getState();
      if (status === "active") {
        if (
          lastActiveAt !== null &&
          Date.now() - lastActiveAt > TIMEOUTS.profileInactiveMs &&
          profiles.length > 1
        ) {
          requestSelector();
        }
        markActive();
      } else if (status === "background" || status === "inactive") {
        markActive();
      }
    };

    handleChange(AppState.currentState);
    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  }, []);
};
