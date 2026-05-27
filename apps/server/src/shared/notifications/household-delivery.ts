// Household-scoped delivery resolution for patient-facing push.
//
// A household shares ONE physical device. Its Expo push token registers
// under the primary account only (POST /auth/push-token keys the token
// to the JWT subject), so non-primary profiles never own a token row of
// their own. A notification for any profile must therefore resolve to
// the household device — not to the profile's (empty) token set.
//
// For a single-profile household these helpers return exactly what a
// `where: { userId }` query returned before: one member, the same
// tokens. Household scope only ever ADDS the shared device — it never
// removes a recipient — so existing single-profile behaviour is
// byte-identical.

import { prisma } from "../database.js";

export interface HouseholdDelivery {
  /** Every user id in the household, the passed-in user included. */
  memberIds: string[];
  /** Distinct Expo push tokens across every device in the household. */
  tokens: string[];
}

/**
 * Every user id sharing a household with `userId` (the user included).
 * Falls back to `[userId]` when the user row is missing, so a caller
 * never silently loses its original recipient.
 */
export const householdUserIds = async (userId: string): Promise<string[]> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { householdId: true },
  });
  if (!user) return [userId];

  const members = await prisma.user.findMany({
    where: { householdId: user.householdId },
    select: { id: true },
  });
  return members.map((m) => m.id);
};

/**
 * Resolves the household membership and the distinct push tokens of the
 * shared device(s) in one pass. `memberIds.length > 1` is the canonical
 * "this is a shared-device household" signal callers use to decide
 * whether to label a notification with the profile name.
 */
export const resolveHouseholdDelivery = async (userId: string): Promise<HouseholdDelivery> => {
  const memberIds = await householdUserIds(userId);
  const tokenRows = await prisma.pushToken.findMany({
    where: { userId: { in: memberIds } },
    select: { token: true },
  });
  return { memberIds, tokens: [...new Set(tokenRows.map((t) => t.token))] };
};
