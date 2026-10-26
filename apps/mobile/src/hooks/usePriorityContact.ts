import { useEffect, useState } from "react";

import {
  readCachedPriorityContact,
  refreshPriorityContact,
  type CallTarget,
} from "@/services/priority-contact";

/**
 * The profile's priority-1 emergency contact while `active`: the cached
 * one at once, then the server's when it answers.
 */
export const usePriorityContact = (userId: string | null, active: boolean): CallTarget | null => {
  const [target, setTarget] = useState<CallTarget | null>(null);

  useEffect(() => {
    if (!active || userId === null) return;
    let cancelled = false;
    void (async () => {
      const cached = await readCachedPriorityContact(userId);
      if (!cancelled && cached) setTarget(cached);
      const fresh = await refreshPriorityContact(userId);
      if (!cancelled) setTarget(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, active]);

  return target;
};
