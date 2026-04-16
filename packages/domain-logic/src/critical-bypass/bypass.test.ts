import { describe, expect, it } from "vitest";
import { decideCriticalBypass } from "./bypass.js";

const baseContacts = [
  { contactId: "c1", priority: 1, isGuardian: true },
  { contactId: "c2", priority: 2, isGuardian: false },
];

describe("critical-bypass thresholds (hardcoded)", () => {
  it("64 → critical low", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 64,
      nowIso: "2026-04-15T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: baseContacts,
    });
    expect(r.isCritical).toBe(true);
    expect(r.severity).toBe("low");
    expect(r.copyKey).toBe("critical.low");
  });

  it("65 → not critical", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 65,
      nowIso: "2026-04-15T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: baseContacts,
    });
    expect(r.isCritical).toBe(false);
  });

  it("315 → not critical", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 315,
      nowIso: "2026-04-15T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: baseContacts,
    });
    expect(r.isCritical).toBe(false);
  });

  it("316 → critical high", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 316,
      nowIso: "2026-04-15T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: baseContacts,
    });
    expect(r.isCritical).toBe(true);
    expect(r.severity).toBe("high");
  });
});

describe("critical-bypass cooldown", () => {
  it("within 30min cooldown → skip push+sms but ALWAYS show fullscreen+call", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 50,
      nowIso: "2026-04-15T10:15:00.000Z",
      lastBypassTriggeredAtIso: "2026-04-15T10:00:00.000Z",
      emergencyContacts: baseContacts,
    });
    expect(r.withinCooldown).toBe(true);
    expect(r.triggerPush).toBe(false);
    expect(r.triggerSmsFallback).toBe(false);
    expect(r.showFullscreenAlert).toBe(true);
    expect(r.showCallButton).toBe(true);
  });

  it("outside cooldown → full chain", () => {
    const r = decideCriticalBypass({
      glucoseValueMgDl: 350,
      nowIso: "2026-04-15T11:00:00.000Z",
      lastBypassTriggeredAtIso: "2026-04-15T10:00:00.000Z",
      emergencyContacts: baseContacts,
    });
    expect(r.withinCooldown).toBe(false);
    expect(r.triggerPush).toBe(true);
    expect(r.triggerSmsFallback).toBe(true);
    expect(r.pushTargets).toEqual(["c1"]);
    expect(r.smsTargets).toEqual(["c1", "c2"]);
  });
});
