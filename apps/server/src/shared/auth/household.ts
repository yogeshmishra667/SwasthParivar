import { DomainError } from "@swasth/shared-types";
import type { AuthClaims } from "../middleware/auth.js";
import { prisma } from "../database.js";

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
