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
  selectorRequired: boolean;
  setHousehold: (id: string, profiles: Profile[]) => void;
  switchProfile: (id: string) => void;
  lockForLogging: () => void;
  unlock: () => void;
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
    set((s) => ({
      activeProfileId: s.profileLockedForLogging ? s.activeProfileId : id,
      lastSwitchedAt: s.profileLockedForLogging ? s.lastSwitchedAt : Date.now(),
      selectorRequired: false,
    })),
  lockForLogging: () => set({ profileLockedForLogging: true }),
  unlock: () => set({ profileLockedForLogging: false }),
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
