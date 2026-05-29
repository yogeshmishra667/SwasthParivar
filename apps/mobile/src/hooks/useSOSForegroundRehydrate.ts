// Phase 4 §D'.2 — re-show the SOS overlay on app foreground.
//
// If the patient backgrounded the app mid-chain (push notification,
// switched to maps, etc.), bringing the app back must NOT drop them
// on the dashboard. We:
//   1. Listen for AppState transitions to "active".
//   2. Fetch /sos/active.
//   3. If non-null, hydrate the SOS store and push the user to /sos.
//
// Idempotent — the hook will short-circuit if there's already an
// active SOS in the local store (no spurious refetches mid-chain).
// Polling continues via `useSOSPolling`; this hook only owns the
// recovery transition.

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useRouter } from "expo-router";
import { getActiveSOS } from "@/services/sos";
import { useSOSStore } from "@/stores/sos.store";

export const useSOSForegroundRehydrate = (): void => {
  const router = useRouter();
  const setActive = useSOSStore((s) => s.setActive);
  // Track last-handled state so a same-state event doesn't refetch.
  const lastState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const handle = async (next: AppStateStatus): Promise<void> => {
      // We only act on the background→active transition. App start
      // (`unknown` → `active`) also flows through here.
      if (next !== "active") {
        lastState.current = next;
        return;
      }
      if (lastState.current === "active") return;
      lastState.current = next;

      // Don't second-guess an in-flight local chain — the store is
      // authoritative for `confirming` and `active` phases.
      const localPhase = useSOSStore.getState().phase;
      if (localPhase === "confirming" || localPhase === "active") return;

      const event = await getActiveSOS();
      if (event === null) return;

      // We have a server-side active SOS but our local store does
      // not — rehydrate and route to the fullscreen.
      setActive(event);
      router.push("/sos");
    };

    const sub = AppState.addEventListener("change", (next) => {
      void handle(next);
    });

    // Run once on mount to cover the cold-start path. The current
    // state is most likely already "active" (the user is staring at
    // the dashboard), but if they tapped a push that bypassed our
    // notification handler, we want the recovery to fire.
    void handle(AppState.currentState);

    return () => {
      sub.remove();
    };
  }, [router, setActive]);
};
