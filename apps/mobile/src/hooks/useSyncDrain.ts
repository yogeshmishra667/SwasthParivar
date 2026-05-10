import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { drainPendingReadings, refreshPendingCount } from "@/services/readings";
import { useAuthStore } from "@/stores/auth.store";
import { logError } from "@/services/analytics";

/**
 * Triggers offline-queue drain at the right moments:
 *
 *   1. Once on auth-token hydration → seeds the badge + flushes any
 *      readings logged during a previous offline session.
 *   2. On NetInfo "connected with internet reachable" — flushes
 *      immediately when the device transitions back online.
 *   3. Every 60s while authenticated — defensive in case (1) and (2)
 *      both miss (rare; e.g. captive-portal Wi-Fi changes).
 *
 * Drains are no-ops when there's no local DB (Expo Go on Android) or
 * no pending rows. The service guards against concurrent drains via
 * `useSyncStore.phase`.
 */
const DEFENSIVE_INTERVAL_MS = 60_000;

export const useSyncDrain = (): void => {
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) return;

    let mounted = true;

    const tryDrain = (): void => {
      if (!mounted) return;
      void drainPendingReadings().catch((err) => logError("useSyncDrain.drain", err));
    };

    // 1. Seed pending count + first drain.
    void refreshPendingCount()
      .then(() => tryDrain())
      .catch((err) => logError("useSyncDrain.seed", err));

    // 2. NetInfo connect listener.
    const netSub = NetInfo.addEventListener((state) => {
      const reachable = state.isConnected === true && state.isInternetReachable !== false;
      if (reachable) tryDrain();
    });

    // 3. Defensive interval.
    const interval = setInterval(tryDrain, DEFENSIVE_INTERVAL_MS);

    return () => {
      mounted = false;
      netSub();
      clearInterval(interval);
    };
  }, [accessToken]);
};
