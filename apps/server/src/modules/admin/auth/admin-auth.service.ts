// Admin console authentication — email + password + mandatory TOTP 2FA.
//
// Flow: POST /login (password) → a short-lived `challengeToken` →
// either /totp/verify (enrolled) or /totp/enroll + /totp/confirm (first
// login). Only the TOTP step mints the access + refresh tokens, so a
// password alone never yields a usable session.

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import QRCode from "qrcode";
import type { AdminUser } from "@prisma/client";
import {
  DomainError,
  type AdminLoginResult,
  type AdminTotpEnrollment,
  type AdminUserDto,
} from "@swasth/shared-types";
import { prisma } from "../../../shared/database.js";
import { env } from "../../../config/env.js";

const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";
const CHALLENGE_TTL = "10m";

/** Refresh-cookie lifetime in ms — keep in sync with REFRESH_TTL. */
export const ADMIN_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ±1 time-step (±30s) of tolerance so minor authenticator clock skew
// still verifies. Passed per-call to otplib as `epochTolerance` (seconds).
const TOTP_EPOCH_TOLERANCE_SEC = 30;

// A real bcrypt hash compared against when the email is unknown, so a
// login probe costs the same whether or not the account exists — defeats
// account enumeration by response timing.
const DUMMY_HASH = bcrypt.hashSync("admin-console-timing-equalizer", 10);

const secrets = (): { access: string; refresh: string } => {
  if (!env.ADMIN_JWT_SECRET || !env.ADMIN_JWT_REFRESH_SECRET) {
    throw new DomainError("ADMIN_FORBIDDEN", "admin console disabled — admin JWT secrets unset");
  }
  return { access: env.ADMIN_JWT_SECRET, refresh: env.ADMIN_JWT_REFRESH_SECRET };
};

const toDto = (a: AdminUser): AdminUserDto => ({
  id: a.id,
  email: a.email,
  name: a.name,
  role: a.role,
  active: a.active,
  totpEnabled: a.totpEnabled,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

type ChallengeStage = "totp" | "enroll";

interface ChallengeClaims {
  sub: string;
  type: "admin_challenge";
  stage: ChallengeStage;
}

const signChallenge = (sub: string, stage: ChallengeStage): string =>
  jwt.sign({ sub, type: "admin_challenge", stage }, secrets().access, {
    expiresIn: CHALLENGE_TTL,
  });

const verifyChallenge = (token: string, stage: ChallengeStage): string => {
  let claims: ChallengeClaims;
  try {
    claims = jwt.verify(token, secrets().access) as ChallengeClaims;
  } catch {
    throw new DomainError("ADMIN_2FA_REQUIRED", "challenge expired — log in again");
  }
  if (claims.type !== "admin_challenge" || claims.stage !== stage) {
    throw new DomainError("ADMIN_2FA_REQUIRED", "invalid challenge token");
  }
  return claims.sub;
};

const signAccess = (sub: string): string =>
  jwt.sign({ sub, type: "admin_access" }, secrets().access, { expiresIn: ACCESS_TTL });

const signRefresh = (sub: string): string =>
  jwt.sign({ sub, type: "admin_refresh" }, secrets().refresh, { expiresIn: REFRESH_TTL });

/** Constant-time TOTP check with clock-skew tolerance. */
const isTotpCodeValid = async (secret: string, code: string): Promise<boolean> => {
  const { valid } = await verifyOtp({
    secret,
    token: code,
    epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
  });
  return valid;
};

export interface AuthenticatedResult {
  result: Extract<AdminLoginResult, { stage: "authenticated" }>;
  refreshToken: string;
}

const completeSignIn = async (admin: AdminUser): Promise<AuthenticatedResult> => {
  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });
  return {
    result: { stage: "authenticated", accessToken: signAccess(admin.id), admin: toDto(updated) },
    refreshToken: signRefresh(admin.id),
  };
};

export const login = async (email: string, password: string): Promise<AdminLoginResult> => {
  const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "invalid email or password");
  }
  const passwordOk = await bcrypt.compare(password, admin.passwordHash);
  if (!passwordOk) {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "invalid email or password");
  }
  if (!admin.active) {
    throw new DomainError("ADMIN_ACCOUNT_DISABLED", "admin account is disabled");
  }

  if (admin.totpEnabled) {
    return { stage: "totp_required", challengeToken: signChallenge(admin.id, "totp") };
  }
  return { stage: "totp_enrollment_required", challengeToken: signChallenge(admin.id, "enroll") };
};

export const enrollTotp = async (challengeToken: string): Promise<AdminTotpEnrollment> => {
  const adminId = verifyChallenge(challengeToken, "enroll");
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "admin account not found");
  if (admin.totpEnabled) {
    throw new DomainError("ADMIN_2FA_INVALID", "2FA already enrolled — log in with a code");
  }

  const secret = generateSecret();
  await prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecret: secret } });

  const otpauthUrl = generateURI({
    issuer: env.ADMIN_TOTP_ISSUER,
    label: admin.email,
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
};

export const confirmTotpEnrollment = async (
  challengeToken: string,
  code: string,
): Promise<AuthenticatedResult> => {
  const adminId = verifyChallenge(challengeToken, "enroll");
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin?.totpSecret) {
    throw new DomainError("ADMIN_2FA_INVALID", "no enrollment in progress");
  }
  if (!(await isTotpCodeValid(admin.totpSecret, code))) {
    throw new DomainError("ADMIN_2FA_INVALID", "incorrect code");
  }
  if (!admin.totpEnabled) {
    await prisma.adminUser.update({ where: { id: admin.id }, data: { totpEnabled: true } });
  }
  return await completeSignIn(admin);
};

export const verifyTotp = async (
  challengeToken: string,
  code: string,
): Promise<AuthenticatedResult> => {
  const adminId = verifyChallenge(challengeToken, "totp");
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin || !admin.totpEnabled || !admin.totpSecret) {
    throw new DomainError("ADMIN_2FA_REQUIRED", "2FA not set up");
  }
  if (!admin.active) {
    throw new DomainError("ADMIN_ACCOUNT_DISABLED", "admin account is disabled");
  }
  if (!(await isTotpCodeValid(admin.totpSecret, code))) {
    throw new DomainError("ADMIN_2FA_INVALID", "incorrect code");
  }
  return await completeSignIn(admin);
};

interface RefreshClaims {
  sub: string;
  type: "admin_refresh";
}

export const refresh = async (
  refreshToken: string | undefined,
): Promise<{ accessToken: string; refreshToken: string }> => {
  if (!refreshToken) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "missing refresh token");
  let claims: RefreshClaims;
  try {
    claims = jwt.verify(refreshToken, secrets().refresh) as RefreshClaims;
  } catch {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "invalid or expired refresh token");
  }
  if (claims.type !== "admin_refresh") {
    throw new DomainError("ADMIN_INVALID_CREDENTIALS", "wrong token type");
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: claims.sub } });
  if (!admin) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "admin account not found");
  if (!admin.active) {
    throw new DomainError("ADMIN_ACCOUNT_DISABLED", "admin account is disabled");
  }
  // Sliding session — issue a fresh refresh token alongside the access one.
  return { accessToken: signAccess(admin.id), refreshToken: signRefresh(admin.id) };
};

export const getProfile = async (adminId: string): Promise<AdminUserDto> => {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw new DomainError("ADMIN_INVALID_CREDENTIALS", "admin account not found");
  return toDto(admin);
};
