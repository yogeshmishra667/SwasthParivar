// Apple App Store Server Notifications V2 — signed-JWS verification
// (Phase 4 §K.3 / CLAUDE.md "Payment Webhook Safety"). Apple signs every
// notification (and each nested transaction/renewal info) as an ES256
// JWS whose x5c header carries the DER certificate chain leaf →
// intermediate → Apple root G3. We must:
//
//   1. confirm alg === "ES256" (reject anything else — alg-confusion
//      guard);
//   2. verify the JWS signature against the LEAF certificate's public
//      key;
//   3. verify the x5c chain links (each cert signed by the next);
//   4. confirm the chain terminates at a TRUSTED Apple root we were
//      configured with — never a root the payload itself supplied.
//
// Pure + deterministic: node:crypto only, no IO. Same fail-closed
// philosophy as verifyRazorpaySignature — any missing/short-circuit
// condition returns { valid: false }, never throws into the caller.

import { X509Certificate, createVerify, type KeyObject } from "node:crypto";

export interface AppleJwsResult {
  valid: boolean;
  /** Decoded JWS payload — only present when `valid`. */
  payload?: Record<string, unknown>;
}

interface JwsHeader {
  alg?: string;
  x5c?: string[];
}

const decodeSegment = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Verify an Apple ES256 JWS (outer signedPayload OR a nested
 * signedTransactionInfo / signedRenewalInfo — all share the same chain).
 *
 * @param jws            the compact JWS string
 * @param trustedRootPem PEM of the Apple root CA the deployment trusts
 * @param now            the current time (passed in — keeps this pure);
 *                       used for certificate validity-window checks
 */
export const verifyAppleJws = (
  jws: string | undefined,
  trustedRootPem: string,
  now: Date,
): AppleJwsResult => {
  if (!jws || trustedRootPem.length === 0) return { valid: false };

  const parts = jws.split(".");
  if (parts.length !== 3) return { valid: false };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = decodeSegment(headerB64);
  if (!isRecord(header)) return { valid: false };
  const { alg, x5c } = header as JwsHeader;

  // Alg-confusion guard: Apple only ever uses ES256.
  if (alg !== "ES256") return { valid: false };
  if (!Array.isArray(x5c) || x5c.length < 2) return { valid: false };

  // Build the certificate chain from the x5c header (base64 DER).
  let chain: X509Certificate[];
  try {
    chain = x5c.map((der) => new X509Certificate(Buffer.from(der, "base64")));
  } catch {
    return { valid: false };
  }

  const trustedRoot = safeCert(trustedRootPem);
  if (!trustedRoot) return { valid: false };

  // Every cert (leaf … root) must be within its validity window.
  if (!chain.every((cert) => withinValidity(cert, now))) return { valid: false };

  // (3) chain links: each cert must be signed by the next one up.
  const linksOk = chain.slice(0, -1).every((cert, i) => cert.verify(chain[i + 1]!.publicKey));
  if (!linksOk) return { valid: false };

  // (4) the presented root must BE our trusted root (fingerprint match),
  // not merely chain to some self-declared root in the payload.
  const presentedRoot = chain[chain.length - 1]!;
  if (presentedRoot.fingerprint256 !== trustedRoot.fingerprint256) return { valid: false };

  // (2) JWS signature against the leaf public key. `ieee-p1363` accepts
  // the raw r||s JOSE signature encoding directly (no DER conversion).
  const leaf = chain[0]!;
  if (!verifySignature(`${headerB64}.${payloadB64}`, sigB64, leaf.publicKey)) {
    return { valid: false };
  }

  const payload = decodeSegment(payloadB64);
  if (!isRecord(payload)) return { valid: false };
  return { valid: true, payload };
};

const safeCert = (pem: string): X509Certificate | null => {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
};

const withinValidity = (cert: X509Certificate, now: Date): boolean => {
  // NaN (unparseable date) makes both comparisons false → fails closed,
  // so no explicit NaN guard is needed.
  const t = now.getTime();
  return t >= new Date(cert.validFrom).getTime() && t <= new Date(cert.validTo).getTime();
};

const verifySignature = (signingInput: string, sigB64url: string, key: KeyObject): boolean => {
  try {
    const verifier = createVerify("SHA256");
    verifier.update(signingInput);
    verifier.end();
    return verifier.verify({ key, dsaEncoding: "ieee-p1363" }, Buffer.from(sigB64url, "base64url"));
  } catch {
    return false;
  }
};
