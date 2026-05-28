import { create } from "zustand";

export interface Profile {
  id: string;
  name: string;
  avatarColor: string;
  conditions: string[];
}

export type Tier = "free" | "premium" | "family";

interface ProfileState {
  householdId: string | null;
  // The household primary — the only User in the household with a real
  // phone + JWT. CLAUDE.md: "Guardian role requires login → a guardian
  // is ALWAYS a primary account." Guardian UI (Family tab, invites,
  // patient dashboards) is hidden when `activeProfileId !== primaryUserId`.
  primaryUserId: string | null;
  // Billing tier + max profiles allowed on this household. Sub-profiles
  // share the household's tier (PR 2). `tier`/`memberLimit` null during
  // pre-login / pre-hydrate; the Settings "Add profile" CTA degrades
  // gracefully (no nudge shown) until `/users/me` resolves.
  tier: Tier | null;
  memberLimit: number | null;
  profiles: Profile[];
  activeProfileId: string | null;
  lastSwitchedAt: number | null;
  lastActiveAt: number | null;
  profileLockedForLogging: boolean;
  selectorRequired: boolean;
  setHousehold: (params: {
    householdId: string;
    profiles: Profile[];
    primaryUserId: string | null;
    tier: Tier | null;
    memberLimit: number | null;
  }) => void;
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
  primaryUserId: null,
  tier: null,
  memberLimit: null,
  profiles: [],
  activeProfileId: null,
  lastSwitchedAt: null,
  lastActiveAt: null,
  profileLockedForLogging: false,
  selectorRequired: false,
} satisfies Partial<ProfileState>;

export const useProfileStore = create<ProfileState>((set) => ({
  ...INITIAL,
  setHousehold: ({ householdId, profiles, primaryUserId, tier, memberLimit }) =>
    set((s) => ({
      householdId,
      primaryUserId,
      tier,
      memberLimit,
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

// True when the active profile is the household primary — the only
// state in which the Family / guardian UI is allowed to be visible.
// During pre-login / pre-onboarding (primaryUserId === null) this is
// false, which keeps the tab hidden until the household is hydrated.
export const isActiveProfilePrimary = (s: ProfileState): boolean =>
  s.primaryUserId !== null && s.activeProfileId === s.primaryUserId;

// True when the household is at its member-cap. Used by the Settings
// screen to swap the "Add profile" button for an "Upgrade for more
// profiles" CTA. Conservative when not hydrated yet (returns false so
// the button stays in its enabled default).
export const isAtMemberCap = (s: ProfileState): boolean =>
  s.memberLimit !== null && s.profiles.length >= s.memberLimit;

// Suggested upgrade target for the cap CTA. Mirrors the server's
// NEXT_TIER table — keep them in sync if the tier ladder ever changes.
export const nextTier = (tier: Tier | null): Tier | null => {
  if (tier === "free") return "premium";
  if (tier === "premium") return "family";
  return null;
};
