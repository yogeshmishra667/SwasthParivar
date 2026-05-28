// Phase 4 Feature D' — refresh the active SOS event while a chain
// is open.
//
// The server runs the escalation cron at 30s ticks; we poll
// /api/v1/sos/active at 10s so the mobile UI reflects stage
// transitions roughly when they happen. Polling stops the moment
// the chain enters a terminal state.
//
// The hook is intentionally simple — no jitter, no exponential
// backoff, no manual refresh trigger. Polling is the wrong
// abstraction long-term (websocket / SSE would be better) but is
// the cheapest reliable mechanism for the scaffold.

import { useEffect } from "react";
import { getActiveSOS } from "@/services/sos";
import { useSOSStore } from "@/stores/sos.store";

const POLL_INTERVAL_MS = 10_000;

export const useSOSPolling = (enabled: boolean): void => {
  const setActive = useSOSStore((s) => s.setActive);
  const enterAfter = useSOSStore((s) => s.enterAfter);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      const event = await getActiveSOS();
      if (cancelled) return;
      if (event !== null) {
        setActive(event);
        return;
      }
      // Server says "no active" — the chain reached a terminal state
      // (resolved or cancelled by the server-side cron). Flip to the
      // after-action card so the patient confirms / notes.
      enterAfter();
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, setActive, enterAfter]);
};
