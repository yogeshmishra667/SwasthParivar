// Phase 4 Feature D' — SOS state on the device.
//
// One row at a time — the patient cannot have two SOS events open
// concurrently. The store holds:
//   - active     — the SOSEventDto for the open chain (null = idle)
//   - phase      — local UI phase (`confirming` → `active` → `after`)
//   - trigger    — the timestamp the patient pressed the button
//
// `phase` is local-only: the server stage is on `active.escalationStage`.
// We track the local UI phase separately so the countdown / fullscreen
// can run even when the server response is slow or the network is
// flaky.

import { create } from "zustand";
import type { SOSEventDto } from "@/services/sos";
import { useProfileStore } from "@/stores/profile.store";

export type SOSLocalPhase = "idle" | "confirming" | "active" | "after";

interface SOSState {
  active: SOSEventDto | null;
  phase: SOSLocalPhase;
  triggeredAtMs: number | null;
  startConfirming: () => void;
  cancelConfirming: () => void;
  setActive: (event: SOSEventDto) => void;
  enterAfter: () => void;
  reset: () => void;
}

export const useSOSStore = create<SOSState>((set) => ({
  active: null,
  phase: "idle",
  triggeredAtMs: null,

  startConfirming: () => {
    set({ phase: "confirming", triggeredAtMs: Date.now() });
  },

  cancelConfirming: () => {
    // Defensive: if somehow the lock was set during confirming
    // (rehydration race after a foreground re-show), clear it.
    useProfileStore.getState().unlockForSOS();
    set({ phase: "idle", triggeredAtMs: null, active: null });
  },

  setActive: (event) => {
    // Phase 4 §D'.2 — lock the profile switcher for the duration of
    // the chain. A shared-device household cannot mid-SOS switch to a
    // different patient.
    useProfileStore.getState().lockForSOS();
    set({ active: event, phase: "active" });
  },

  enterAfter: () => {
    // We stay locked through the after-action card so the resolve
    // payload (false alarm? note?) is unambiguously tied to the
    // patient who triggered.
    set({ phase: "after" });
  },

  reset: () => {
    useProfileStore.getState().unlockForSOS();
    set({ active: null, phase: "idle", triggeredAtMs: null });
  },
}));
