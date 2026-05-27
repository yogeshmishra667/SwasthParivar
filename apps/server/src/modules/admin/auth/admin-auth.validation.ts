import { z } from "zod";

// Login is intentionally loose on shape — the account is looked up and
// the password compared regardless, so over-validating leaks nothing and
// only risks rejecting a legitimate (if unusual) credential.
export const adminLoginSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

// Short-lived JWT issued by /login; carried by the TOTP-step requests.
const challengeToken = z.string().min(10);
const totpCode = z.string().regex(/^\d{6}$/, "expected a 6-digit code");

export const adminTotpEnrollSchema = z.object({
  challengeToken,
});

export const adminTotpCodeSchema = z.object({
  challengeToken,
  code: totpCode,
});
