// The one fullscreen critical alert, app-wide (audit P3).
//
// Raised by the log flows (every category, synced or offline), by
// onboarding's first reading, and by a `critical_alert` push. Rendered
// once, by CriticalAlertHost in the root layout, so a critical reading
// gets the same fullscreen alert and call buttons on any screen.

import { create } from "zustand";

export type CriticalAlertCategory = "glucose" | "bp" | "cardiac" | "respiratory";

export interface CriticalAlertRequest {
  /** "patient": on the reading's own device. "guardian": a family member's phone. */
  audience: "patient" | "guardian";
  /** The profile the reading belongs to: its priority-1 contact is the call target. */
  userId: string | null;
  category: CriticalAlertCategory;
  /** glucose / bp. */
  direction?: "low" | "high";
  /** cardiac / respiratory: which copy, e.g. "hr_low" (see `criticalReasonKey`). */
  reasonKey?: string;
  /** As shown, e.g. "48 mg/dL" or "190/120 mmHg". */
  valueLabel?: string;
  /** Guardian alerts: the push's own (localised) title and body. */
  title?: string;
  body?: string;
  /** Guardian alerts: the patient whose details "Open details" shows. */
  patientId?: string;
}

// The cardiac / respiratory copy, keyed by the server's dispatch copy key
// suffix. A local classifier reason maps onto the same keys.
const REASON_KEYS: Readonly<Record<string, string>> = {
  "critical.hr_low": "hr_low",
  "critical.hr_high": "hr_high",
  "critical.chest_pain_severe": "chest_pain",
  "critical.peak_flow_red_zone": "peak_flow",
  "critical.symptom_severe": "severe_symptom",
  "critical.cardiac.hr_low": "hr_low",
  "critical.cardiac.hr_high": "hr_high",
  "critical.cardiac.chest_pain": "chest_pain",
  "critical.respiratory.peak_flow": "peak_flow",
  "critical.respiratory.severe_symptom": "severe_symptom",
};

/** Copy key for a classifier reason or a push copy key; "generic" when unknown. */
export const criticalReasonKey = (reasonOrCopyKey: string | undefined): string =>
  (reasonOrCopyKey !== undefined ? REASON_KEYS[reasonOrCopyKey] : undefined) ?? "generic";

// A push for a reading this device already alerted on locally (the server
// echoing it back) is not shown again.
const LOCAL_ECHO_WINDOW_MS = 10 * 60_000;

/** A raised alert: the request plus an id that is new for every alert. */
export type ShownCriticalAlert = CriticalAlertRequest & { readonly id: number };

interface CriticalAlertState {
  current: ShownCriticalAlert | null;
  /** Alerts waiting for the current one to be closed. */
  queue: readonly ShownCriticalAlert[];
  /** `${userId}:${category}` → when this device last raised it locally. */
  lastLocalRaise: Record<string, number>;
  /** Readings (or notifications) already shown from a push. */
  shownReadingIds: readonly string[];
  /** A reading logged on this device. Always shown. */
  raise: (req: CriticalAlertRequest) => void;
  /**
   * From a push. Skipped when it is the echo of a local alert or was
   * already shown; `dedupeId` is the reading id, else the notification id.
   */
  raiseFromPush: (req: CriticalAlertRequest, dedupeId: string | null) => void;
  /** Closes the current alert and shows the next queued one, if any. */
  dismiss: () => void;
}

const localKey = (req: CriticalAlertRequest): string => `${req.userId ?? "-"}:${req.category}`;

let nextId = 1;

/**
 * Where a new alert goes (P3 review C2, W8). A patient alert shows at once.
 * It replaces the current alert only when that is the same profile's same
 * category (a newer reading, e.g. a retry); any other alert it covers goes
 * back to the front of the queue. A guardian alert never covers anything:
 * it waits in the queue.
 */
const place = (
  s: Pick<CriticalAlertState, "current" | "queue">,
  alert: ShownCriticalAlert,
): Pick<CriticalAlertState, "current" | "queue"> => {
  const shown = s.current;
  if (shown === null) return { current: alert, queue: s.queue };
  if (alert.audience === "guardian") return { current: shown, queue: [...s.queue, alert] };
  const sameReadingStream =
    shown.audience === "patient" &&
    shown.userId === alert.userId &&
    shown.category === alert.category;
  return { current: alert, queue: sameReadingStream ? s.queue : [shown, ...s.queue] };
};

export const useCriticalAlertStore = create<CriticalAlertState>((set, get) => ({
  current: null,
  queue: [],
  lastLocalRaise: {},
  shownReadingIds: [],

  raise: (req) => {
    set((s) => ({
      ...place(s, { ...req, id: nextId++ }),
      lastLocalRaise: { ...s.lastLocalRaise, [localKey(req)]: Date.now() },
    }));
  },

  raiseFromPush: (req, dedupeId) => {
    const s = get();
    if (dedupeId !== null && s.shownReadingIds.includes(dedupeId)) return;
    const last = s.lastLocalRaise[localKey(req)];
    if (
      req.audience === "patient" &&
      last !== undefined &&
      Date.now() - last < LOCAL_ECHO_WINDOW_MS
    ) {
      return;
    }
    set({
      ...place(s, { ...req, id: nextId++ }),
      shownReadingIds:
        dedupeId !== null ? [...s.shownReadingIds.slice(-49), dedupeId] : s.shownReadingIds,
    });
  },

  dismiss: () => {
    set((s) => ({ current: s.queue[0] ?? null, queue: s.queue.slice(1) }));
  },
}));
