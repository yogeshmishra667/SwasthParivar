import { describe, expect, it } from "vitest";
import { planMultiCategoryBypassDispatch } from "./multi-category.js";

const contacts = [
  { contactId: "c1", priority: 1, isGuardian: true },
  { contactId: "c2", priority: 2, isGuardian: false },
  { contactId: "c3", priority: 3, isGuardian: true },
];

describe("planMultiCategoryBypassDispatch — cardiac copy keys", () => {
  it("chest pain dominates HR signals", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_high", "critical.chest_pain_severe"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.copyKey).toBe("critical.cardiac.chest_pain");
  });

  it("hr_high beats hr_low when both improbably co-occur", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_high"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.copyKey).toBe("critical.cardiac.hr_high");
  });

  it("hr_low is the default cardiac copy when no other reason matched", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_low"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.copyKey).toBe("critical.cardiac.hr_low");
  });
});

describe("planMultiCategoryBypassDispatch — respiratory copy keys", () => {
  it("peak-flow red zone beats severe symptom when both present", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "respiratory",
      reasons: ["critical.peak_flow_red_zone", "critical.symptom_severe"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.copyKey).toBe("critical.respiratory.peak_flow");
  });

  it("severe symptom alone routes to the symptom template", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "respiratory",
      reasons: ["critical.symptom_severe"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.copyKey).toBe("critical.respiratory.severe_symptom");
  });
});

describe("planMultiCategoryBypassDispatch — cooldown semantics", () => {
  it("within 30-min cooldown → push/SMS suppressed but fullscreen + call still on", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_low"],
      nowIso: "2026-06-05T10:15:00.000Z",
      lastBypassTriggeredAtIso: "2026-06-05T10:00:00.000Z",
      emergencyContacts: contacts,
    });
    expect(r.withinCooldown).toBe(true);
    expect(r.triggerPush).toBe(false);
    expect(r.triggerSmsFallback).toBe(false);
    expect(r.showFullscreenAlert).toBe(true);
    expect(r.showCallButton).toBe(true);
    expect(r.pushTargets).toEqual([]);
    expect(r.smsTargets).toEqual([]);
  });

  it("exactly 30 min later → cooldown clears (strict <)", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "respiratory",
      reasons: ["critical.symptom_severe"],
      nowIso: "2026-06-05T10:30:00.000Z",
      lastBypassTriggeredAtIso: "2026-06-05T10:00:00.000Z",
      emergencyContacts: contacts,
    });
    expect(r.withinCooldown).toBe(false);
    expect(r.triggerPush).toBe(true);
  });

  it("no prior bypass → not in cooldown", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_low"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.withinCooldown).toBe(false);
    expect(r.triggerPush).toBe(true);
  });
});

describe("planMultiCategoryBypassDispatch — target resolution", () => {
  it("pushTargets are guardian-only, in priority order", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_low"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.pushTargets).toEqual(["c1", "c3"]);
  });

  it("smsTargets include every contact, in priority order", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "respiratory",
      reasons: ["critical.peak_flow_red_zone"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: contacts,
    });
    expect(r.smsTargets).toEqual(["c1", "c2", "c3"]);
  });

  it("contacts are sorted defensively when caller passes out-of-order", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_high"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: [
        { contactId: "c3", priority: 3, isGuardian: true },
        { contactId: "c1", priority: 1, isGuardian: true },
        { contactId: "c2", priority: 2, isGuardian: false },
      ],
    });
    expect(r.pushTargets).toEqual(["c1", "c3"]);
    expect(r.smsTargets).toEqual(["c1", "c2", "c3"]);
  });

  it("no contacts → empty target lists, dispatch still produced", () => {
    const r = planMultiCategoryBypassDispatch({
      category: "cardiac",
      reasons: ["critical.hr_low"],
      nowIso: "2026-06-05T10:00:00.000Z",
      lastBypassTriggeredAtIso: null,
      emergencyContacts: [],
    });
    expect(r.pushTargets).toEqual([]);
    expect(r.smsTargets).toEqual([]);
    expect(r.showFullscreenAlert).toBe(true);
    expect(r.showCallButton).toBe(true);
  });
});
