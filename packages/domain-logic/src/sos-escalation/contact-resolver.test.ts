import { describe, expect, it } from "vitest";

import { eligibleContactsForStage, selectContactForStage } from "./contact-resolver.js";
import type { SOSContact, SOSStage } from "./types.js";

const contact = (overrides: Partial<SOSContact> = {}): SOSContact => ({
  id: overrides.id ?? "c1",
  name: overrides.name ?? "Rohan",
  phone: overrides.phone ?? "+919800000001",
  priority: overrides.priority ?? 1,
  isGuardian: overrides.isGuardian ?? true,
});

const guardian = (id: string, priority: number): SOSContact =>
  contact({ id, priority, isGuardian: true, phone: `+9198${id}` });

const friend = (id: string, priority: number): SOSContact =>
  contact({ id, priority, isGuardian: false, phone: `+9197${id}` });

describe("selectContactForStage — stage_0_fullscreen", () => {
  it("returns null — no remote dispatch at stage 0 (in-app only)", () => {
    const result = selectContactForStage({
      stage: "stage_0_fullscreen",
      contacts: [guardian("a", 1), guardian("b", 2)],
      alreadyAttempted: [],
    });
    expect(result).toBeNull();
  });
});

describe("selectContactForStage — stage_1_auto_dial", () => {
  it("returns the priority-1 contact", () => {
    const result = selectContactForStage({
      stage: "stage_1_auto_dial",
      contacts: [guardian("b", 2), guardian("a", 1)],
      alreadyAttempted: [],
    });
    expect(result?.id).toBe("a");
  });

  it("returns null once the priority-1 has been attempted", () => {
    const result = selectContactForStage({
      stage: "stage_1_auto_dial",
      contacts: [guardian("a", 1), guardian("b", 2)],
      alreadyAttempted: ["a"],
    });
    expect(result).toBeNull();
  });

  it("returns null with an empty contact list", () => {
    expect(
      selectContactForStage({
        stage: "stage_1_auto_dial",
        contacts: [],
        alreadyAttempted: [],
      }),
    ).toBeNull();
  });

  it("does NOT promote a friend (non-guardian) to priority-1 if the only guardian is attempted", () => {
    // Phase 4 §D'.2 — stage_1 is the priority-1 contact specifically.
    // It doesn't fall through to friends; the state machine moves on
    // to stage_2 instead.
    const result = selectContactForStage({
      stage: "stage_1_auto_dial",
      contacts: [guardian("a", 1), friend("f", 2)],
      alreadyAttempted: ["a"],
    });
    expect(result).toBeNull();
  });
});

describe("selectContactForStage — stage_2_ivr_call", () => {
  const contacts = [
    friend("f1", 1), // non-guardian, ignored at stage 2
    guardian("g2", 2),
    guardian("g3", 3),
    friend("f4", 4),
  ];

  it("walks guardians in priority order, skipping non-guardians", () => {
    const first = selectContactForStage({
      stage: "stage_2_ivr_call",
      contacts,
      alreadyAttempted: [],
    });
    expect(first?.id).toBe("g2");

    const second = selectContactForStage({
      stage: "stage_2_ivr_call",
      contacts,
      alreadyAttempted: ["g2"],
    });
    expect(second?.id).toBe("g3");

    const third = selectContactForStage({
      stage: "stage_2_ivr_call",
      contacts,
      alreadyAttempted: ["g2", "g3"],
    });
    expect(third).toBeNull();
  });

  it("returns null when no contacts are guardians", () => {
    const result = selectContactForStage({
      stage: "stage_2_ivr_call",
      contacts: [friend("f1", 1), friend("f2", 2)],
      alreadyAttempted: [],
    });
    expect(result).toBeNull();
  });
});

describe("selectContactForStage — stage_3_all_contacts", () => {
  const contacts = [friend("f3", 3), guardian("g1", 1), friend("f2", 2)];

  it("walks every contact in priority order regardless of role", () => {
    const order: string[] = [];
    const attempted: string[] = [];
    while (true) {
      const c = selectContactForStage({
        stage: "stage_3_all_contacts",
        contacts,
        alreadyAttempted: attempted,
      });
      if (!c) break;
      order.push(c.id);
      attempted.push(c.id);
    }
    expect(order).toEqual(["g1", "f2", "f3"]);
  });

  it("equal-priority contacts sort by id (stable, deterministic)", () => {
    const ties = [
      contact({ id: "alpha", priority: 1, isGuardian: false }),
      contact({ id: "bravo", priority: 1, isGuardian: false }),
      contact({ id: "charlie", priority: 1, isGuardian: false }),
    ];
    const first = selectContactForStage({
      stage: "stage_3_all_contacts",
      contacts: ties,
      alreadyAttempted: [],
    });
    expect(first?.id).toBe("alpha");
  });
});

describe("selectContactForStage — terminal stages", () => {
  it.each<SOSStage>(["resolved", "cancelled"])("%s returns null", (stage) => {
    const result = selectContactForStage({
      stage,
      contacts: [guardian("a", 1)],
      alreadyAttempted: [],
    });
    expect(result).toBeNull();
  });
});

describe("eligibleContactsForStage — preview", () => {
  const contacts = [friend("f3", 3), guardian("g1", 1), guardian("g2", 2)];

  it("stage_0 returns []", () => {
    expect(eligibleContactsForStage("stage_0_fullscreen", contacts)).toEqual([]);
  });

  it("stage_1 returns just the priority-1 contact", () => {
    expect(eligibleContactsForStage("stage_1_auto_dial", contacts).map((c) => c.id)).toEqual([
      "g1",
    ]);
  });

  it("stage_2 returns only guardians, in priority order", () => {
    expect(eligibleContactsForStage("stage_2_ivr_call", contacts).map((c) => c.id)).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("stage_3 returns everyone, in priority order", () => {
    expect(eligibleContactsForStage("stage_3_all_contacts", contacts).map((c) => c.id)).toEqual([
      "g1",
      "g2",
      "f3",
    ]);
  });

  it("stage_1 on an empty list returns []", () => {
    expect(eligibleContactsForStage("stage_1_auto_dial", [])).toEqual([]);
  });

  it.each<SOSStage>(["resolved", "cancelled"])("%s returns []", (stage) => {
    expect(eligibleContactsForStage(stage, contacts)).toEqual([]);
  });
});
