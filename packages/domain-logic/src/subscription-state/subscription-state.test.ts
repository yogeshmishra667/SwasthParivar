import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyRazorpaySignature } from "./razorpay-signature.js";
import { razorpayEventToTransition } from "./transitions.js";

const SECRET = "whsec_test_razorpay";
const sign = (body: string, secret = SECRET): string =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("verifyRazorpaySignature", () => {
  const body = JSON.stringify({ event: "subscription.activated", id: "evt_1" });

  it("accepts a correct HMAC-SHA256 signature (string body)", () => {
    expect(verifyRazorpaySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a correct signature over Buffer body", () => {
    expect(verifyRazorpaySignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyRazorpaySignature(body, sign(body, "wrong"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body);
    expect(verifyRazorpaySignature(body + "x", sig, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyRazorpaySignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects when the secret is empty (fail closed)", () => {
    expect(verifyRazorpaySignature(body, sign(body), "")).toBe(false);
  });

  it("rejects a signature of a different length without throwing", () => {
    expect(verifyRazorpaySignature(body, "deadbeef", SECRET)).toBe(false);
  });
});

describe("razorpayEventToTransition", () => {
  it("subscription.activated → upgrade to premium (default)", () => {
    const d = razorpayEventToTransition({
      eventType: "subscription.activated",
      currentTier: "free",
    });
    expect(d).toMatchObject({ action: "activate", targetTier: "premium", changesTier: true });
  });

  it("subscription.activated honours an explicit purchasedTier (family)", () => {
    const d = razorpayEventToTransition({
      eventType: "subscription.activated",
      currentTier: "free",
      purchasedTier: "family",
    });
    expect(d.targetTier).toBe("family");
  });

  it("subscription.authenticated also activates", () => {
    expect(
      razorpayEventToTransition({ eventType: "subscription.authenticated", currentTier: "free" })
        .action,
    ).toBe("activate");
  });

  it("subscription.charged extends without changing tier", () => {
    const d = razorpayEventToTransition({
      eventType: "subscription.charged",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "extend", targetTier: "premium", changesTier: false });
  });

  it("subscription.cancelled schedules cancel, keeps tier until period end", () => {
    const d = razorpayEventToTransition({
      eventType: "subscription.cancelled",
      currentTier: "premium",
    });
    expect(d).toMatchObject({
      action: "schedule_cancel",
      targetTier: "premium",
      changesTier: false,
      cancelAtPeriodEnd: true,
      status: "cancelled",
    });
  });

  it("subscription.paused → grace, tier retained", () => {
    const d = razorpayEventToTransition({
      eventType: "subscription.paused",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "grace", status: "grace", changesTier: false });
  });

  it("payment.failed → past_due, no downgrade", () => {
    const d = razorpayEventToTransition({ eventType: "payment.failed", currentTier: "premium" });
    expect(d).toMatchObject({ action: "past_due", targetTier: "premium", changesTier: false });
  });

  it("subscription.halted → past_due", () => {
    expect(
      razorpayEventToTransition({ eventType: "subscription.halted", currentTier: "premium" })
        .action,
    ).toBe("past_due");
  });

  it("refund.processed → immediate downgrade to free", () => {
    const d = razorpayEventToTransition({
      eventType: "refund.processed",
      currentTier: "premium",
    });
    expect(d).toMatchObject({ action: "downgrade", targetTier: "free", changesTier: true });
  });

  it("refund.created on an already-free user does not flag a tier change", () => {
    const d = razorpayEventToTransition({ eventType: "refund.created", currentTier: "free" });
    expect(d).toMatchObject({ action: "downgrade", targetTier: "free", changesTier: false });
  });

  it("unknown event → ignore, tier untouched", () => {
    const d = razorpayEventToTransition({ eventType: "subscription.weird", currentTier: "family" });
    expect(d).toMatchObject({ action: "ignore", targetTier: "family", changesTier: false });
  });
});
