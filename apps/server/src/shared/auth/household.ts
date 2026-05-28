import { DomainError } from "@swasth/shared-types";
import type { AuthClaims } from "../middleware/auth.js";
import { prisma } from "../database.js";

/**
 * Returns true when the caller is the household primary — the only
 * member of the household with a real phone + JWT. Sub-profiles created
 * via POST /household/profiles can never be primaries (CLAUDE.md
 * "Guardian role requires login → a guardian is ALWAYS a primary
 * account").
 *
 * Guards on guardian-side endpoints + household-administrative writes
 * (add profile, change tier in PR 2) flow through this check.
 */
export const isHouseholdPrimary = async (auth: AuthClaims): Promise<boolean> => {
  const household = await prisma.household.findUnique({
    where: { id: auth.householdId },
    select: { primaryUserId: true },
  });
  return household?.primaryUserId === auth.sub;
};

export const requireHouseholdPrimary = async (auth: AuthClaims): Promise<void> => {
  if (!(await isHouseholdPrimary(auth))) {
    throw new DomainError("FAMILY_NO_ACCESS", "only the household primary can perform this action");
  }
};

/**
 * Resolves the effective user id for an action.
 *
 * - `targetUserId` omitted or equal to the caller → caller acts on self.
 * - `targetUserId` set to another user → must share `householdId` with the
 *   caller (the JWT carries it, so this is a single DB read on the target).
 *
 * Throws `FAMILY_NO_ACCESS` if the target is missing or in another
 * household. The shared-phone profile switcher (CLAUDE.md) is the only
 * legitimate caller of cross-user writes today.
 */
export const resolveHouseholdMember = async (
  auth: AuthClaims,
  targetUserId: string | undefined,
): Promise<string> => {
  if (!targetUserId || targetUserId === auth.sub) return auth.sub;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { householdId: true },
  });
  if (target?.householdId !== auth.householdId) {
    throw new DomainError("FAMILY_NO_ACCESS", "target user not in your household");
  }
  return targetUserId;
};
