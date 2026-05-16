// Phase 2 step 7 — family/guardian validation schemas.
//
// Invite shape: patient supplies the guardian's phone (E.164) plus
// optional metadata. Guardian discovery happens in the service layer
// (lookup by phone, 404 if no user with that phone exists yet — Phase 2
// does not pre-register guardians on the patient's behalf).
//
// Privacy + accept/decline take the FamilyLink `id` as the path
// parameter; route-level UUID parsing keeps controllers thin.

import { z } from "zod";

// Allow the same E.164-ish format auth.send-otp already uses
// (+ followed by 10–15 digits). Patients enter "+91…" with country code
// in the onboarding screen, so we don't auto-prepend.
const phoneSchema = z.string().regex(/^\+[1-9]\d{9,14}$/, "phone must be E.164 (e.g. +9198…)");

export const inviteCreateSchema = z.object({
  guardianPhone: phoneSchema,
  relationship: z.string().min(1).max(40).optional(),
  // Visible conditions: subset of the patient's `conditions` array. We
  // *don't* enum-validate against `Condition` here so that a future
  // condition like `respiratory` doesn't require a coordinated mobile
  // release; the service intersects with the patient's actual list.
  visibleConditions: z.array(z.string().min(1).max(40)).max(10).default([]),
  alertEnabled: z.boolean().default(true),
  alertSensitivity: z.enum(["low", "medium", "high"]).default("medium"),
});

// Guardian-side decision on a pending invite.
export const inviteRespondSchema = z.object({
  decision: z.enum(["accept", "decline"]),
});

// Patient-side privacy update on a specific link. All fields optional —
// the mobile UI sends only what changed. At least one required.
export const privacyUpdateSchema = z
  .object({
    visibleConditions: z.array(z.string().min(1).max(40)).max(10).optional(),
    alertEnabled: z.boolean().optional(),
    alertSensitivity: z.enum(["low", "medium", "high"]).optional(),
    // Patient-initiated revoke. Guardian-initiated revoke is the same
    // /family/links/:id endpoint; we discriminate by role server-side.
    revoke: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.visibleConditions !== undefined ||
      v.alertEnabled !== undefined ||
      v.alertSensitivity !== undefined ||
      v.revoke !== undefined,
    "at least one field is required",
  );

// Dashboard listing query — Phase 2 supports a status filter so the
// mobile UI can show pending vs accepted invites in different tabs.
export const listPatientsQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "declined", "revoked"]).default("accepted"),
});
