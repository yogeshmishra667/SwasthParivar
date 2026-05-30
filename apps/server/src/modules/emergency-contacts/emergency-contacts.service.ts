// Phase 1 corrigendum — emergency-contact CRUD service.
//
// CLAUDE.md "EmergencyContact" schema + Patch #3 "Multiple Emergency
// Contacts" describe HOW the bypass chain reads these rows but never
// specified the write surface. This module fills that gap: a patient
// or the household primary on a sub-profile's behalf can add / edit /
// delete contacts, and the existing critical-bypass + SOS code paths
// pick them up unchanged (both already query by
// `EmergencyContact.userId orderBy priority`).
//
// Invariants enforced here (not just by Zod):
//   - Max 5 contacts per patient. Beyond that the elderly-friendly
//     UI is unscannable and the bypass chain only reaches the top 3
//     anyway.
//   - Priority is unique per patient — if two contacts both claim
//     priority=1, the dialer chain is non-deterministic. On create
//     with a colliding priority we cascade-shift the existing rows
//     down (1→2, 2→3, …) inside a single transaction.
//   - Cross-user writes are household-authorised via
//     `resolveHouseholdMember` — same pattern as family.service.ts.

import { DomainError } from "@swasth/shared-types";
import { prisma } from "../../shared/database.js";
import { resolveHouseholdMember } from "../../shared/auth/household.js";
import type { AuthClaims } from "../../shared/middleware/auth.js";
import type {
  CreateContactInput,
  EmergencyContactDto,
  UpdateContactInput,
} from "./emergency-contacts.types.js";

const MAX_CONTACTS_PER_USER = 5;

const toDto = (row: {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isGuardian: boolean;
  createdAt: Date;
}): EmergencyContactDto => ({
  id: row.id,
  userId: row.userId,
  name: row.name,
  phone: row.phone,
  relationship: row.relationship,
  priority: row.priority,
  isGuardian: row.isGuardian,
  createdAt: row.createdAt.toISOString(),
});

export const listContacts = async (
  auth: AuthClaims,
  targetUserId: string | undefined,
): Promise<EmergencyContactDto[]> => {
  const userId = await resolveHouseholdMember(auth, targetUserId);
  const rows = await prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
};

export const createContact = async (
  auth: AuthClaims,
  params: {
    name: string;
    phone: string;
    relationship: string;
    priority: number;
    isGuardian: boolean;
    targetUserId?: string;
  },
): Promise<EmergencyContactDto> => {
  const userId = await resolveHouseholdMember(auth, params.targetUserId);

  return await prisma.$transaction(async (tx) => {
    const count = await tx.emergencyContact.count({ where: { userId } });
    if (count >= MAX_CONTACTS_PER_USER) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `Maximum ${MAX_CONTACTS_PER_USER} emergency contacts allowed`,
      );
    }

    // Priority-uniqueness: shift any existing row at >= the requested
    // priority down by one. We use `updateMany` + monotonic ordering so
    // the result is deterministic. Doing this in the same transaction
    // as the insert guarantees no window where two rows share priority.
    await tx.emergencyContact.updateMany({
      where: { userId, priority: { gte: params.priority } },
      data: { priority: { increment: 1 } },
    });

    const created = await tx.emergencyContact.create({
      data: {
        userId,
        name: params.name,
        phone: params.phone,
        relationship: params.relationship,
        priority: params.priority,
        isGuardian: params.isGuardian,
      },
    });

    // After the shift+insert, normalise the priority sequence so it
    // stays a dense 1..N range. Without this, repeated insertions at
    // priority=1 with a small contact list would slowly push the
    // bottom row past the max-5 cap on read ordering.
    await renumberPriorities(tx as unknown as typeof prisma, userId);

    // Re-fetch after renumber so the returned DTO reflects the
    // canonical priority, not the pre-renumber value.
    const fresh = await tx.emergencyContact.findUniqueOrThrow({
      where: { id: created.id },
    });
    return toDto(fresh);
  });
};

export const updateContact = async (
  auth: AuthClaims,
  params: {
    contactId: string;
    name?: string;
    phone?: string;
    relationship?: string;
    priority?: number;
    isGuardian?: boolean;
  },
): Promise<EmergencyContactDto> => {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.emergencyContact.findUnique({
      where: { id: params.contactId },
    });
    if (!existing) {
      throw new DomainError("VALIDATION_ERROR", "emergency contact not found");
    }
    // Authorise: caller must be in the same household as the contact's
    // owning user. `resolveHouseholdMember` enforces this and throws
    // FAMILY_NO_ACCESS on a cross-household attempt.
    await resolveHouseholdMember(auth, existing.userId);

    // If priority is changing, shift other rows to keep the sequence
    // dense and collision-free. Pattern mirrors `createContact`.
    if (params.priority !== undefined && params.priority !== existing.priority) {
      if (params.priority < existing.priority) {
        // Moving up: bump everyone in [new, old) down by 1.
        await tx.emergencyContact.updateMany({
          where: {
            userId: existing.userId,
            id: { not: existing.id },
            priority: { gte: params.priority, lt: existing.priority },
          },
          data: { priority: { increment: 1 } },
        });
      } else {
        // Moving down: bump everyone in (old, new] up by 1.
        await tx.emergencyContact.updateMany({
          where: {
            userId: existing.userId,
            id: { not: existing.id },
            priority: { gt: existing.priority, lte: params.priority },
          },
          data: { priority: { decrement: 1 } },
        });
      }
    }

    const updated = await tx.emergencyContact.update({
      where: { id: params.contactId },
      data: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.phone !== undefined ? { phone: params.phone } : {}),
        ...(params.relationship !== undefined ? { relationship: params.relationship } : {}),
        ...(params.priority !== undefined ? { priority: params.priority } : {}),
        ...(params.isGuardian !== undefined ? { isGuardian: params.isGuardian } : {}),
      },
    });
    return toDto(updated);
  });
};

export const deleteContact = async (auth: AuthClaims, contactId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.emergencyContact.findUnique({ where: { id: contactId } });
    if (!existing) {
      throw new DomainError("VALIDATION_ERROR", "emergency contact not found");
    }
    await resolveHouseholdMember(auth, existing.userId);

    await tx.emergencyContact.delete({ where: { id: contactId } });
    await renumberPriorities(tx as unknown as typeof prisma, existing.userId);
  });
};

// Compacts the priority sequence to 1..N. Called after every mutation
// so a delete or shift never leaves gaps. The pure ordering function
// (sort by priority asc, then createdAt asc) preserves the operator's
// intent across rewrites.
const renumberPriorities = async (client: typeof prisma, userId: string): Promise<void> => {
  const rows = await client.emergencyContact.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    await client.emergencyContact.update({
      where: { id: row.id },
      data: { priority: i + 1 },
    });
  }
};

// Convenience for tests / domain callers.
export const __internals = { MAX_CONTACTS_PER_USER };
// Make types referenced in interfaces externally visible.
export type { CreateContactInput, UpdateContactInput };
