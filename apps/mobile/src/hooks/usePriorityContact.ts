import { useEffect, useState } from "react";

import { track } from "@/services/analytics";
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
  // Keyed by profile: a lookup for one profile is never handed back for
  // another, e.g. after a profile switch while the refresh hangs (P2
  // review C1).
  const [state, setState] = useState<{ forUserId: string; target: CallTarget | null } | null>(null);

  useEffect(() => {
    if (!active || userId === null) return;
    let cancelled = false;
    void (async () => {
      const cached = await readCachedPriorityContact(userId);
      if (!cancelled && cached) setState({ forUserId: userId, target: cached });
      const fresh = await refreshPriorityContact(userId);
      if (cancelled) return;
      setState({ forUserId: userId, target: fresh });
      if (!fresh) track("critical_alert_no_contact");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, active]);

  return state !== null && state.forUserId === userId ? state.target : null;
};
