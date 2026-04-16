import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { TIMEOUTS } from "@/utils/constants";

export interface OfflineStatus {
  isOffline: boolean;
  offlineSince: number | null;
  showBanner: boolean;
}

export const useOfflineStatus = (): OfflineStatus => {
  const [isOffline, setIsOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      if (offline && !isOffline) {
        setOfflineSince(Date.now());
      } else if (!offline) {
        setOfflineSince(null);
      }
      setIsOffline(offline);
    });
    return unsub;
  }, [isOffline]);

  const showBanner =
    isOffline &&
    offlineSince !== null &&
    Date.now() - offlineSince >= TIMEOUTS.offlineBannerThresholdMs;

  return { isOffline, offlineSince, showBanner };
};
