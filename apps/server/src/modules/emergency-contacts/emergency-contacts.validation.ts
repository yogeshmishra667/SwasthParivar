// Phase 1 corrigendum — emergency contact CRUD validation.
//
// `EmergencyContact` rows feed the Phase 1 critical-low/high bypass
// (SMS + auto-dial to the priority-1 contact) and the Phase 4 SOS
// escalation chain. Both downstreams already exist; this surface lets
// patients and guardians actually populate the table from the app.
//
// Shape mirrors the Prisma model: name, phone (E.164), relationship,
// priority (1 = highest), isGuardian flag. Phone uses the same E.164
// regex auth.validation.ts uses so onboarding + contact entry stay
// consistent.

import { z } from "zod";

// Same E.164 shape auth + family use. Patients enter `+91…` with country
// code; we don't auto-prepend.
const phoneSchema = z.string().regex(/^\+[1-9]\d{9,14}$/, "phone must be E.164 (e.g. +9198…)");

// CLAUDE.md "Emergency Contacts": priority 1 is the canonical dialer
// target. We cap at 5 — beyond that the UI is no longer scannable for
// elderly users, and the bypass chain only iterates the top three
// anyway. The cap is enforced in the service (count check) AND here
// (per-row).
const prioritySchema = z.number().int().min(1).max(5);

export const createContactSchema = z.object({
  name: z.string().min(1).max(60),
  phone: phoneSchema,
  relationship: z.string().min(1).max(40),
  priority: prioritySchema,
  isGuardian: z.boolean().default(false),
  // Optional — when the caller is the household primary creating a
  // contact for a sub-profile. Resolved + household-authorised via
  // `resolveHouseholdMember` in the service. Same pattern as family.
  targetUserId: z.string().uuid().optional(),
});

export const updateContactSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    phone: phoneSchema.optional(),
    relationship: z.string().min(1).max(40).optional(),
    priority: prioritySchema.optional(),
    isGuardian: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.phone !== undefined ||
      v.relationship !== undefined ||
      v.priority !== undefined ||
      v.isGuardian !== undefined,
    "at least one field is required",
  );

export const listContactsQuerySchema = z.object({
  // Same `targetUserId` pattern as create. When omitted the caller
  // lists their own contacts.
  targetUserId: z.string().uuid().optional(),
});
