// Per-user feature gates for patient-facing surfaces (audit D3).
//
// A cohort or percentage flag value is an object, which a
// `getFlag<boolean>` read treats as truthy: ON for everyone, while the app
// (which resolves the flag per user via `GET /config/features`) showed it
// to the cohort only. These gates resolve the flag per user with the
// CC.12 `isFeatureEnabled`, keyed by the household's account (its
// primary). That is the id `/config/features` uses, so the API and the app
// agree for every profile on a shared phone.
//
// A plain true/false behaves exactly as before, with no extra lookup.

import { prisma } from "./database.js";
import { getFlag, type FlagValue } from "./flags/index.js";
import { isFeatureEnabled } from "./rollout.js";

/** The household primary for a profile; the profile itself when it has none. */
const householdAccountId = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { household: { select: { primaryUserId: true } } },
  });
  return user?.household.primaryUserId ?? userId;
};

/** Is `featureKey` on for the household that `userId` (any profile) belongs to? */
export const isFeatureEnabledFor = async (featureKey: string, userId: string): Promise<boolean> => {
  const config = await getFlag<FlagValue>(featureKey, false);
  if (typeof config === "boolean") return config;
  return await isFeatureEnabled(featureKey, await householdAccountId(userId));
};
