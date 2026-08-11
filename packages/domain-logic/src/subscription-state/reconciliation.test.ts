import { describe, expect, it } from "vitest";
import { reconcileRazorpaySubscription, type LocalSubscriptionSnapshot } from "./reconciliation.js";

const NOW = Date.UTC(2026, 7, 11, 0, 0, 0); // 2026-08-11
const DAY = 86_400_000;

const local = (over: Partial<LocalSubscriptionSnapshot> = {}): LocalSubscriptionSnapshot => ({
  tier: "premium",
  status: "active",
  currentPeriodEndMs: NOW + 20 * DAY,
  ...over,
});

describe("reconcileRazorpaySubscription", () => {
  describe("active / authenticated", () => {
    it("no local row + provider active → replay activation", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "active",
        providerCurrentEndMs: NOW + 30 * DAY,
        nowMs: NOW,
        local: null,
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.activated",
        reason: "missed_activation",
      });
    });

    it("local free + provider active → replay activation", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "authenticated",
        providerCurrentEndMs: NOW + 30 * DAY,
        nowMs: NOW,
        local: local({ tier: "free", status: "cancelled" }),
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.activated");
    });

    it("local premium+active but provider period advanced → replay charge (extend)", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "active",
        providerCurrentEndMs: NOW + 40 * DAY,
        nowMs: NOW,
        local: local({ currentPeriodEndMs: NOW + 20 * DAY }),
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.charged",
        reason: "missed_renewal",
      });
    });

    it("local premium+active with null local period end + provider end → extend", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "active",
        providerCurrentEndMs: NOW + 40 * DAY,
        nowMs: NOW,
        local: local({ currentPeriodEndMs: null }),
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.charged");
    });

    it("local premium+active, period already up to date → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "active",
        providerCurrentEndMs: NOW + 20 * DAY,
        nowMs: NOW,
        local: local({ currentPeriodEndMs: NOW + 20 * DAY }),
      });
      expect(d).toEqual({ apply: false, eventType: "", reason: "consistent" });
    });

    it("local premium+active, provider period end absent → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "active",
        providerCurrentEndMs: null,
        nowMs: NOW,
        local: local(),
      });
      expect(d.apply).toBe(false);
    });
  });

  describe("pending / halted (past_due)", () => {
    it("provider halted + local not past_due → replay halted", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "halted",
        providerCurrentEndMs: NOW + 5 * DAY,
        nowMs: NOW,
        local: local(),
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.halted",
        reason: "missed_past_due",
      });
    });

    it("provider pending + no local row → replay halted", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "pending",
        providerCurrentEndMs: null,
        nowMs: NOW,
        local: null,
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.halted");
    });

    it("provider halted + local already past_due → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "halted",
        providerCurrentEndMs: NOW + 5 * DAY,
        nowMs: NOW,
        local: local({ status: "past_due" }),
      });
      expect(d.apply).toBe(false);
    });
  });

  describe("paused (grace)", () => {
    it("provider paused + local not grace → replay pause", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "paused",
        providerCurrentEndMs: NOW + 5 * DAY,
        nowMs: NOW,
        local: local(),
      });
      expect(d).toEqual({ apply: true, eventType: "subscription.paused", reason: "missed_grace" });
    });

    it("provider paused + no local row → replay pause", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "paused",
        providerCurrentEndMs: NOW + 5 * DAY,
        nowMs: NOW,
        local: null,
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.paused");
    });

    it("provider paused + local already grace → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "paused",
        providerCurrentEndMs: NOW + 5 * DAY,
        nowMs: NOW,
        local: local({ status: "grace" }),
      });
      expect(d.apply).toBe(false);
    });
  });

  describe("cancelled", () => {
    it("cancel still inside paid period + local not cancelled → schedule cancel", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW + 10 * DAY,
        nowMs: NOW,
        local: local({ status: "active" }),
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.cancelled",
        reason: "missed_cancel",
      });
    });

    it("cancel still inside paid period + local already cancelled → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW + 10 * DAY,
        nowMs: NOW,
        local: local({ status: "cancelled" }),
      });
      expect(d.apply).toBe(false);
    });

    it("cancel still inside paid period + no local row → replay schedule cancel", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW + 10 * DAY,
        nowMs: NOW,
        local: null,
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.cancelled");
    });

    it("cancel with no provider period end → treated as within period", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: null,
        nowMs: NOW,
        local: local({ status: "active" }),
      });
      expect(d.apply).toBe(true);
      expect(d.eventType).toBe("subscription.cancelled");
    });

    it("cancel whose paid period has lapsed + local still premium → downgrade", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: local({ status: "cancelled", tier: "premium" }),
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.expired",
        reason: "cancel_lapsed",
      });
    });

    it("cancel lapsed + local already free → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: local({ status: "cancelled", tier: "free" }),
      });
      expect(d.apply).toBe(false);
    });

    it("cancel lapsed + no local row → no-op (nothing to downgrade)", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "cancelled",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: null,
      });
      expect(d.apply).toBe(false);
    });
  });

  describe("completed / expired", () => {
    it("provider completed + local still premium → downgrade", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "completed",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: local({ tier: "premium" }),
      });
      expect(d).toEqual({
        apply: true,
        eventType: "subscription.expired",
        reason: "period_ended",
      });
    });

    it("provider expired + local already free → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "expired",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: local({ tier: "free" }),
      });
      expect(d.apply).toBe(false);
    });

    it("provider completed + no local row → no-op", () => {
      const d = reconcileRazorpaySubscription({
        providerStatus: "completed",
        providerCurrentEndMs: NOW - DAY,
        nowMs: NOW,
        local: null,
      });
      expect(d.apply).toBe(false);
    });
  });

  it("unmodelled provider status (created) → no-op", () => {
    const d = reconcileRazorpaySubscription({
      providerStatus: "created",
      providerCurrentEndMs: NOW + 30 * DAY,
      nowMs: NOW,
      local: null,
    });
    expect(d).toEqual({ apply: false, eventType: "", reason: "consistent" });
  });
});
