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
