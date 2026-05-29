import { create } from "zustand";

export interface Profile {
  id: string;
  name: string;
  avatarColor: string;
  conditions: string[];
}

interface ProfileState {
  householdId: string | null;
  profiles: Profile[];
  activeProfileId: string | null;
  lastSwitchedAt: number | null;
  lastActiveAt: number | null;
  profileLockedForLogging: boolean;
  /** Phase 4 §D'.2 — locked for the duration of an active SOS chain.
   *  The shared-device profile cannot switch mid-SOS, so a guardian
   *  reaching the patient on the household primary's phone hands it
   *  back focused on the right profile. Cleared on SOS resolve /
   *  cancel via `unlockForSOS`. */
  profileLockedForSOS: boolean;
  selectorRequired: boolean;
  setHousehold: (id: string, profiles: Profile[]) => void;
  switchProfile: (id: string) => void;
  lockForLogging: () => void;
  unlock: () => void;
  lockForSOS: () => void;
  unlockForSOS: () => void;
  markActive: () => void;
  requestSelector: () => void;
  dismissSelector: () => void;
  reset: () => void;
}

const INITIAL = {
  householdId: null,
  profiles: [],
  activeProfileId: null,
  lastSwitchedAt: null,
  lastActiveAt: null,
  profileLockedForLogging: false,
  profileLockedForSOS: false,
  selectorRequired: false,
} satisfies Partial<ProfileState>;

export const useProfileStore = create<ProfileState>((set) => ({
  ...INITIAL,
  setHousehold: (id, profiles) =>
    set((s) => ({
      householdId: id,
      profiles,
      activeProfileId: s.activeProfileId ?? profiles[0]?.id ?? null,
    })),
  switchProfile: (id) =>
    set((s) => {
      // Either lock blocks the switch — logging or SOS. Both must
      // clear before the user can move to another profile.
      const locked = s.profileLockedForLogging || s.profileLockedForSOS;
      return {
        activeProfileId: locked ? s.activeProfileId : id,
        lastSwitchedAt: locked ? s.lastSwitchedAt : Date.now(),
        selectorRequired: false,
      };
    }),
  lockForLogging: () => set({ profileLockedForLogging: true }),
  unlock: () => set({ profileLockedForLogging: false }),
  lockForSOS: () => set({ profileLockedForSOS: true }),
  unlockForSOS: () => set({ profileLockedForSOS: false }),
  markActive: () => set({ lastActiveAt: Date.now() }),
  requestSelector: () => set({ selectorRequired: true }),
  dismissSelector: () => set({ selectorRequired: false }),
  // Clears all household/profile state. Called on logout so a fresh
  // login on the same device never inherits the previous account's
  // active profile (which would no longer match any new household row).
  reset: () => set(INITIAL),
}));

export const selectActiveProfile = (s: ProfileState): Profile | null =>
  s.profiles.find((p) => p.id === s.activeProfileId) ?? null;

export const isRecentSwitch = (s: ProfileState, withinMs = 30_000): boolean =>
  s.lastSwitchedAt !== null && Date.now() - s.lastSwitchedAt < withinMs;
