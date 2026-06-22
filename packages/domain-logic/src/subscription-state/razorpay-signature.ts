// Razorpay webhook signature verification (Phase 4 §K.2 / CLAUDE.md
// "Payment Webhook Safety"). Razorpay signs the RAW request body with
// HMAC-SHA256 keyed by the webhook secret and sends it in the
// `X-Razorpay-Signature` header. We recompute and compare in constant
// time. A mismatch → reject with NO state change (the caller maps this
// to 401 + Sentry page).
//
// Pure + deterministic: node:crypto only, no IO. The caller passes the
// raw body bytes (never the re-serialised JSON — that would not
// byte-match what Razorpay signed).

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * @param rawBody  verbatim request body bytes
 * @param signature value of the `X-Razorpay-Signature` header
 * @param secret   `RAZORPAY_WEBHOOK_SECRET`
 * @returns true iff the signature is a valid HMAC-SHA256 of the body
 */
export const verifyRazorpaySignature = (
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean => {
  // A missing header or an unconfigured secret can never verify — fail
  // closed rather than skipping the check.
  if (!signature || secret.length === 0) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length guard first — timingSafeEqual throws on unequal lengths.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};
