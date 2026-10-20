import { describe, expect, it, beforeAll } from "vitest";
import { createSign, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAppleJws } from "./apple-jws.js";
import { appleNotificationToTransition } from "./transitions.js";

// A real ES256 (P-256) cert chain is generated once via openssl so the
// JWS-verification path is exercised end-to-end, the same way the
// Razorpay tests exercise the real HMAC. `leaf` is signed by `root`;
// `otherRoot` is an unrelated trust anchor for the negative case.
const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");

const openssl = (dir: string, args: string[]): void => {
  const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`openssl ${args.join(" ")} failed: ${r.stderr}`);
};

interface Chain {
  rootPem: string;
  leafKeyPem: string;
  x5c: string[]; // [leafDER_b64, rootDER_b64]
}

const makeChain = (dir: string, cn: string): Chain => {
  openssl(dir, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${cn}-root.key`]);
  openssl(dir, [
    "req",
    "-x509",
    "-new",
    "-key",
    `${cn}-root.key`,
    "-subj",
    `/CN=${cn} Root`,
    "-days",
    "2",
    "-out",
    `${cn}-root.pem`,
  ]);
  openssl(dir, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${cn}-leaf.key`]);
  openssl(dir, [
    "req",
    "-new",
    "-key",
    `${cn}-leaf.key`,
    "-subj",
    `/CN=${cn} Leaf`,
    "-out",
    `${cn}-leaf.csr`,
  ]);
  openssl(dir, [
    "x509",
    "-req",
    "-in",
    `${cn}-leaf.csr`,
    "-CA",
    `${cn}-root.pem`,
    "-CAkey",
    `${cn}-root.key`,
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    `${cn}-leaf.pem`,
  ]);
  const rootPem = readFileSync(join(dir, `${cn}-root.pem`), "utf-8");
  const leafPem = readFileSync(join(dir, `${cn}-leaf.pem`), "utf-8");
  const leafKeyPem = readFileSync(join(dir, `${cn}-leaf.key`), "utf-8");
  const leafDer = new X509Certificate(leafPem).raw.toString("base64");
  const rootDer = new X509Certificate(rootPem).raw.toString("base64");
  return { rootPem, leafKeyPem, x5c: [leafDer, rootDer] };
};

let dir: string;
let chain: Chain;
let otherRoot: Chain;
let now: Date;

const signJws = (payload: unknown, opts: { x5c?: string[]; alg?: string } = {}): string => {
  const header = { alg: opts.alg ?? "ES256", x5c: opts.x5c ?? chain.x5c };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signer = createSign("SHA256");
  signer.update(`${h}.${p}`);
  signer.end();
  const sig = signer.sign({ key: chain.leafKeyPem, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64url(sig)}`;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "apple-jws-"));
  chain = makeChain(dir, "apple");
  otherRoot = makeChain(dir, "evil");
  // Capture `now` only AFTER both chains exist. openssl truncates
  // notBefore to the second, so a `now` taken at file-load time can land
  // before the "evil" certs' validity window when their generation
  // crosses a second boundary — the broken-chain case then fails the
  // validity check instead of the chain-link check, and the 100%
  // subscription-state coverage ratchet flakes.
  now = new Date();
});

describe("verifyAppleJws", () => {
  it("accepts a well-formed JWS signed by the trusted chain", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED", hello: "world" });
    const res = verifyAppleJws(jws, chain.rootPem, now);
    expect(res.valid).toBe(true);
    expect(res.payload).toMatchObject({ notificationType: "SUBSCRIBED", hello: "world" });
  });

  it("rejects a tampered payload", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" });
    const [h, , s] = jws.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ notificationType: "REFUND" }))}.${s}`;
    expect(verifyAppleJws(forged, chain.rootPem, now).valid).toBe(false);
  });

  it("rejects a chain that terminates at an untrusted root", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" });
    // Verified against a DIFFERENT trusted root → fingerprint mismatch.
    expect(verifyAppleJws(jws, otherRoot.rootPem, now).valid).toBe(false);
  });

  it("rejects a non-ES256 alg (alg-confusion guard)", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" }, { alg: "HS256" });
    expect(verifyAppleJws(jws, chain.rootPem, now).valid).toBe(false);
  });

  it("rejects when the certificate is outside its validity window", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" });
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // +10 days > 2-day cert
    expect(verifyAppleJws(jws, chain.rootPem, future).valid).toBe(false);
  });

  it("fails closed on malformed input", () => {
    expect(verifyAppleJws(undefined, chain.rootPem, now).valid).toBe(false);
    expect(verifyAppleJws("not.a.jws.at.all", chain.rootPem, now).valid).toBe(false);
    expect(verifyAppleJws(signJws({}), "", now).valid).toBe(false);
  });

  it("rejects a single-cert x5c (no chain to a root)", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" }, { x5c: [chain.x5c[0]!] });
    expect(verifyAppleJws(jws, chain.rootPem, now).valid).toBe(false);
  });

  it("fails closed on a non-JSON header segment", () => {
    expect(verifyAppleJws("%%%.%%%.%%%", chain.rootPem, now).valid).toBe(false);
  });

  it("fails closed when x5c entries are not valid certificates", () => {
    const header = b64url(JSON.stringify({ alg: "ES256", x5c: ["Zm9v", "YmFy"] }));
    const payload = b64url(JSON.stringify({ notificationType: "SUBSCRIBED" }));
    expect(verifyAppleJws(`${header}.${payload}.AA`, chain.rootPem, now).valid).toBe(false);
  });

  it("fails closed when the trusted root PEM is malformed", () => {
    const jws = signJws({ notificationType: "SUBSCRIBED" });
    const badPem = "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----";
    expect(verifyAppleJws(jws, badPem, now).valid).toBe(false);
  });

  it("fails closed when signature verification throws (bad signature length)", () => {
    const [h, p] = signJws({ notificationType: "SUBSCRIBED" }).split(".");
    const badSig = `${h}.${p}.${b64url(Buffer.from([1, 2, 3]))}`;
    expect(verifyAppleJws(badSig, chain.rootPem, now).valid).toBe(false);
  });

  it("rejects a broken chain link (leaf not signed by the presented root)", () => {
    // evil leaf + trusted (apple) root: the link cannot verify.
    const header = b64url(JSON.stringify({ alg: "ES256", x5c: [otherRoot.x5c[0], chain.x5c[1]] }));
    const payload = b64url(JSON.stringify({ notificationType: "SUBSCRIBED" }));
    expect(verifyAppleJws(`${header}.${payload}.AA`, chain.rootPem, now).valid).toBe(false);
  });

  it("rejects a validly-signed payload that is not a JSON object", () => {
    // Signature verifies, but the payload decodes to a string, not a record.
    expect(verifyAppleJws(signJws("just a string"), chain.rootPem, now).valid).toBe(false);
  });
});

describe("appleNotificationToTransition", () => {
  it("SUBSCRIBED activates to the purchased tier", () => {
    const d = appleNotificationToTransition({
      notificationType: "SUBSCRIBED",
      currentTier: "free",
      purchasedTier: "family",
    });
    expect(d).toMatchObject({ action: "activate", targetTier: "family", changesTier: true });
  });

  it("SUBSCRIBED without a resolved product defaults to premium", () => {
    const d = appleNotificationToTransition({
      notificationType: "SUBSCRIBED",
      currentTier: "free",
    });
    expect(d.targetTier).toBe("premium");
  });

  it("DID_RENEW extends without changing tier", () => {
    const d = appleNotificationToTransition({
      notificationType: "DID_RENEW",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "extend", changesTier: false, targetTier: "premium" });
  });

  it("auto-renew-off schedules cancel but keeps the tier", () => {
    const d = appleNotificationToTransition({
      notificationType: "DID_CHANGE_RENEWAL_STATUS",
      subtype: "AUTO_RENEW_DISABLED",
      currentTier: "premium",
    });
    expect(d).toMatchObject({
      action: "schedule_cancel",
      changesTier: false,
      cancelAtPeriodEnd: true,
      targetTier: "premium",
    });
  });

  it("auto-renew-on is a no-op", () => {
    const d = appleNotificationToTransition({
      notificationType: "DID_CHANGE_RENEWAL_STATUS",
      subtype: "AUTO_RENEW_ENABLED",
      currentTier: "premium",
    });
    expect(d.action).toBe("ignore");
  });

  it("DID_FAIL_TO_RENEW in grace keeps the tier", () => {
    const d = appleNotificationToTransition({
      notificationType: "DID_FAIL_TO_RENEW",
      subtype: "GRACE_PERIOD",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "grace", status: "grace", changesTier: false });
  });

  it("DID_FAIL_TO_RENEW without grace is past_due (no downgrade)", () => {
    const d = appleNotificationToTransition({
      notificationType: "DID_FAIL_TO_RENEW",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "past_due", changesTier: false, targetTier: "premium" });
  });

  it.each(["EXPIRED", "GRACE_PERIOD_EXPIRED", "REFUND", "REVOKE"])(
    "%s downgrades to free (data retained by the service)",
    (notificationType) => {
      const d = appleNotificationToTransition({ notificationType, currentTier: "premium" });
      expect(d).toMatchObject({ action: "downgrade", targetTier: "free", changesTier: true });
    },
  );

  it("an unknown notification type is ignored", () => {
    const d = appleNotificationToTransition({
      notificationType: "SOMETHING_NEW",
      currentTier: "premium",
    });
    expect(d.action).toBe("ignore");
  });
});

// Clean up the temp cert dir after the suite.
import { afterAll } from "vitest";
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
