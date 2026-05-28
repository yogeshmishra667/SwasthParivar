// Shared DTOs for the admin / ops console. Used by apps/server (the
// admin API) and apps/admin (the React console) so the API contract is
// type-checked on both sides. See docs/admin-dashboard-plan.md.

/** RBAC role of an admin/staff account. Mirrors the Prisma `AdminRole` enum. */
export type AdminRole = "super_admin" | "ops" | "support" | "analyst";

/** An admin/staff account as exposed to the console (never includes secrets). */
export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Result of `POST /admin/auth/login` — a two-stage flow.
 *  - `totp_required`            password OK, account has TOTP → submit a code.
 *  - `totp_enrollment_required` password OK, TOTP not yet set up → must enrol.
 *  - `authenticated`            fully signed in (only after TOTP verify).
 * `challengeToken` is a short-lived JWT scoped to the TOTP step only.
 */
export type AdminLoginResult =
  | { stage: "totp_required"; challengeToken: string }
  | { stage: "totp_enrollment_required"; challengeToken: string }
  | { stage: "authenticated"; accessToken: string; admin: AdminUserDto };

/** Returned by `POST /admin/auth/totp/enroll` — shown once during setup. */
export interface AdminTotpEnrollment {
  /** base32 secret, for manual authenticator-app entry. */
  secret: string;
  /** otpauth:// URI encoding the secret + issuer. */
  otpauthUrl: string;
  /** PNG data URL of the otpauth QR code. */
  qrDataUrl: string;
}

/** One row of the admin audit trail. */
export interface AdminAuditLogDto {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

// ── Patient user inspection (admin user-detail view) ─────────────────

/** Patient (app user) subscription tier — mirrors the Prisma `Tier` enum. */
export type AdminTier = "free" | "premium" | "family";

/** A patient user as shown in the admin user list and co-profile lists. */
export interface AdminPatientListItem {
  id: string;
  name: string;
  phone: string;
  age: number;
  tier: AdminTier;
  conditions: string[];
  onboardingComplete: boolean;
  householdId: string;
  createdAt: string;
  // Phase 4 Week 13 admin carry-over — soft-disable surface.
  active: boolean;
  deactivatedAt: string | null;
  deactivationReason: string | null;
}

/** A page of patient users. Offset pagination — admin grids want page jumps. */
export interface AdminPatientList {
  users: AdminPatientListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Full profile fields shown on the detailed user view. */
export interface AdminPatientProfile extends AdminPatientListItem {
  gender: string | null;
  preferredLanguage: string;
  timezone: string;
  onboardingStep: number;
  timeAnomalyCount: number;
  updatedAt: string;
}

/** Metadata for one registered resource panel in the user-detail view. */
export interface AdminResourcePanelMeta {
  key: string;
  label: string;
  description: string;
  sensitive: boolean;
}

/** The detailed 360° view of one patient user. */
export interface AdminPatientDetail {
  user: AdminPatientProfile;
  /** Other profiles sharing the household (shared-phone setup). */
  coProfiles: AdminPatientListItem[];
  /** UserStreak row, or null if the user has never logged. */
  streak: unknown;
  /** NotificationState row, or null. */
  notificationState: unknown;
  /** Registered resource panels — each fetched lazily by key. */
  panels: AdminResourcePanelMeta[];
}

/** One page of a registry resource panel for a patient user. */
export interface AdminResourcePanelData {
  key: string;
  label: string;
  /** Whether viewing this panel was audit-logged as a sensitive-data view. */
  sensitive: boolean;
  rows: unknown[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Result of a patient tier change. PR 2 moves tier to the household,
 *  so the change is scoped to the household (the user id is just the
 *  one the admin clicked through). `householdId` + `memberLimit` are
 *  added so the admin UI can show the cap that came with the new tier
 *  without an extra fetch. `overCap` is true when the downgrade left
 *  the household over its new member cap — the UI should surface a
 *  warning, but no profiles are ever deleted. */
export interface AdminTierChangeResult {
  id: string;
  householdId: string;
  previousTier: AdminTier;
  previousMemberLimit: number;
  tier: AdminTier;
  memberLimit: number;
  memberCount: number;
  overCap: boolean;
}

/** Result of a patient (de)activation toggle. `previouslyActive` lets the
 *  UI render an idempotent "already deactivated" toast without a second
 *  round-trip; the audit log only carries a row on a real transition. */
export interface AdminUserActivationResult {
  id: string;
  active: boolean;
  previouslyActive: boolean;
  deactivatedAt: string | null;
  deactivationReason: string | null;
}
