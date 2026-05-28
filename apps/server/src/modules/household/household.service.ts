import { randomBytes } from "node:crypto";
import { DomainError, type Condition } from "@swasth/shared-types";
import type { Gender, Language } from "@prisma/client";
import { prisma } from "../../shared/database.js";
import type { AddHouseholdProfileInput } from "./household.validation.js";

/**
 * Adds a profile to the caller's household.
 *
 * Why a synthesized phone:
 *   The current `User` schema requires `phone` to be unique and
 *   non-null. Phase 1 doesn't ship the broader auth refactor where
 *   non-primary household members authenticate via the primary's JWT
 *   plus an `X-Active-User-Id` header (planned). To unblock the
 *   "shared phone profile switcher" without touching the auth
 *   model, we mint a deterministic-but-unique synthetic phone of the
 *   form `household:<owner-uuid>:<8-byte-hex>`. The colon prefix puts
 *   it firmly outside the E.164 space so anyone doing later analytics
 *   on the column can filter these out trivially.
 *
 *   Profiles created this way cannot log in independently — they only
 *   exist as data attached to the household and are surfaced via
 *   `GET /users/me`'s `householdProfiles` list. That matches CLAUDE.md's
 *   shared-device model.
 *
 * Cap:
 *   `household.memberLimit` — derived from the household's tier
 *   (free=1, premium=4, family=10). The cap is stored on the household
 *   so admin/billing can query/audit it directly; the source of truth
 *   for tier → cap is `shared/billing/tier-caps.ts`.
 */

const synthesizedPhoneFor = (ownerId: string): string =>
  `household:${ownerId}:${randomBytes(8).toString("hex")}`;

interface ProfileRow {
  id: string;
  name: string;
  age: number;
  gender: Gender | null;
  conditions: Condition[];
  preferredLanguage: Language;
}

export const addHouseholdProfile = async (
  callerUserId: string,
  input: AddHouseholdProfileInput,
): Promise<ProfileRow> => {
  const caller = await prisma.user.findUniqueOrThrow({
    where: { id: callerUserId },
    select: {
      householdId: true,
      timezone: true,
      preferredLanguage: true,
      household: { select: { tier: true, memberLimit: true } },
    },
  });

  const existingCount = await prisma.user.count({
    where: { householdId: caller.householdId },
  });
  if (existingCount >= caller.household.memberLimit) {
    throw new DomainError(
      "HOUSEHOLD_MEMBER_LIMIT",
      `household at ${caller.household.tier} cap (${caller.household.memberLimit} members) — upgrade to add more`,
    );
  }

  const created = await prisma.user.create({
    data: {
      name: input.name,
      age: input.age,
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      conditions: input.conditions,
      // Inherit primary's timezone — household members share a device.
      timezone: caller.timezone,
      preferredLanguage: input.preferredLanguage ?? caller.preferredLanguage,
      householdId: caller.householdId,
      onboardingComplete: true,
      onboardingStep: 5,
      // Synthesized phone preserves uniqueness without altering schema.
      phone: synthesizedPhoneFor(callerUserId),
    },
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      conditions: true,
      preferredLanguage: true,
    },
  });

  return created;
};

/**
 * `phone` field on a household profile is intentionally synthetic for
 * non-primary members. This guard prevents the synthetic prefix from
 * leaking to clients via any list endpoint that selects the column.
 */
export const isSyntheticHouseholdPhone = (phone: string): boolean => phone.startsWith("household:");
