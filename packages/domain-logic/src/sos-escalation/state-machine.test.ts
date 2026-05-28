import { describe, expect, it } from "vitest";

import { isSOSChainActive, nextSOSStage } from "./state-machine.js";
import {
  SOS_ALL_CONTACTS_AFTER_SECONDS,
  SOS_AUTO_DIAL_AFTER_SECONDS,
  SOS_IVR_AFTER_SECONDS,
  type SOSStage,
  type SOSStateInput,
} from "./types.js";

const baseInput = (overrides: Partial<SOSStateInput> = {}): SOSStateInput => ({
  currentStage: "stage_0_fullscreen",
  elapsedSecondsSinceTrigger: 0,
  patientCancelled: false,
  anyContactAnsweredCall: false,
  resolved: false,
  externallyCancelled: false,
  ...overrides,
});

describe("nextSOSStage — terminal sticky", () => {
  it.each<SOSStage>(["resolved", "cancelled"])("%s is terminal, stays put", (terminal) => {
    const result = nextSOSStage(baseInput({ currentStage: terminal }));
    expect(result.changed).toBe(false);
    expect(result.nextStage).toBe(terminal);
    expect(result.reason).toBe("no_change");
  });

  it("terminal ignores even strong signals like resolved=true", () => {
    // Once cancelled, even another resolve signal must not flip the
    // row — the audit trail would lie about why the chain stopped.
    const result = nextSOSStage(
      baseInput({ currentStage: "cancelled", resolved: true, anyContactAnsweredCall: true }),
    );
    expect(result.nextStage).toBe("cancelled");
    expect(result.changed).toBe(false);
  });
});

describe("nextSOSStage — precedence", () => {
  it("resolved wins over everything", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_1_auto_dial",
        resolved: true,
        externallyCancelled: true,
        patientCancelled: true,
        anyContactAnsweredCall: true,
        elapsedSecondsSinceTrigger: 10_000,
      }),
    );
    expect(result.nextStage).toBe("resolved");
    expect(result.reason).toBe("resolved");
  });

  it("externallyCancelled wins over patientCancelled", () => {
    const result = nextSOSStage(baseInput({ externallyCancelled: true, patientCancelled: true }));
    expect(result.nextStage).toBe("cancelled");
    expect(result.reason).toBe("cancelled_external");
  });

  it("patientCancelled triggers when no higher signal present", () => {
    const result = nextSOSStage(baseInput({ patientCancelled: true }));
    expect(result.nextStage).toBe("cancelled");
    expect(result.reason).toBe("cancelled_by_patient");
  });

  it("contact answered → resolved", () => {
    const result = nextSOSStage(
      baseInput({ currentStage: "stage_2_ivr_call", anyContactAnsweredCall: true }),
    );
    expect(result.nextStage).toBe("resolved");
    expect(result.reason).toBe("contact_answered");
  });

  it("contact answered outranks timeout transition", () => {
    // At stage_0 + elapsed past 60s the chain would normally go to
    // stage_1, but a contact answering ends the whole thing.
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_0_fullscreen",
        anyContactAnsweredCall: true,
        elapsedSecondsSinceTrigger: SOS_AUTO_DIAL_AFTER_SECONDS + 5,
      }),
    );
    expect(result.nextStage).toBe("resolved");
    expect(result.reason).toBe("contact_answered");
  });
});

describe("nextSOSStage — timeout transitions", () => {
  it("stage_0 → stage_1 at exactly the auto-dial threshold", () => {
    const result = nextSOSStage(
      baseInput({ elapsedSecondsSinceTrigger: SOS_AUTO_DIAL_AFTER_SECONDS }),
    );
    expect(result.nextStage).toBe("stage_1_auto_dial");
    expect(result.reason).toBe("auto_dial_timeout");
    expect(result.changed).toBe(true);
  });

  it("stage_0 stays put just before the threshold", () => {
    const result = nextSOSStage(
      baseInput({ elapsedSecondsSinceTrigger: SOS_AUTO_DIAL_AFTER_SECONDS - 1 }),
    );
    expect(result.nextStage).toBe("stage_0_fullscreen");
    expect(result.changed).toBe(false);
  });

  it("stage_1 → stage_2 at IVR threshold", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_1_auto_dial",
        elapsedSecondsSinceTrigger: SOS_IVR_AFTER_SECONDS,
      }),
    );
    expect(result.nextStage).toBe("stage_2_ivr_call");
    expect(result.reason).toBe("ivr_timeout");
  });

  it("stage_1 stays put just before IVR threshold", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_1_auto_dial",
        elapsedSecondsSinceTrigger: SOS_IVR_AFTER_SECONDS - 1,
      }),
    );
    expect(result.nextStage).toBe("stage_1_auto_dial");
    expect(result.changed).toBe(false);
  });

  it("stage_2 → stage_3 at all-contacts threshold", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_2_ivr_call",
        elapsedSecondsSinceTrigger: SOS_ALL_CONTACTS_AFTER_SECONDS,
      }),
    );
    expect(result.nextStage).toBe("stage_3_all_contacts");
    expect(result.reason).toBe("all_contacts_timeout");
  });

  it("stage_2 stays put just before all-contacts threshold", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_2_ivr_call",
        elapsedSecondsSinceTrigger: SOS_ALL_CONTACTS_AFTER_SECONDS - 1,
      }),
    );
    expect(result.nextStage).toBe("stage_2_ivr_call");
    expect(result.changed).toBe(false);
  });

  it("stage_3 has no further timeout transition", () => {
    const result = nextSOSStage(
      baseInput({
        currentStage: "stage_3_all_contacts",
        elapsedSecondsSinceTrigger: 100_000,
      }),
    );
    expect(result.nextStage).toBe("stage_3_all_contacts");
    expect(result.reason).toBe("no_change");
  });

  it("a late cron tick catches up by one stage at a time (monotonic, not skip)", () => {
    // The processor is expected to call nextSOSStage repeatedly until
    // it converges. A first call from stage_0 with elapsed = 600s
    // moves to stage_1 (auto_dial_timeout fires because stage_0's
    // threshold matched); the SECOND call from stage_1 with the same
    // elapsed will then advance to stage_2 (ivr_timeout). The third
    // call advances to stage_3. The state machine is monotonic and
    // safe to re-invoke.
    let cur: SOSStage = "stage_0_fullscreen";
    cur = nextSOSStage(baseInput({ currentStage: cur, elapsedSecondsSinceTrigger: 600 })).nextStage;
    expect(cur).toBe("stage_1_auto_dial");
    cur = nextSOSStage(baseInput({ currentStage: cur, elapsedSecondsSinceTrigger: 600 })).nextStage;
    expect(cur).toBe("stage_2_ivr_call");
    cur = nextSOSStage(baseInput({ currentStage: cur, elapsedSecondsSinceTrigger: 600 })).nextStage;
    expect(cur).toBe("stage_3_all_contacts");
  });
});

describe("nextSOSStage — idempotency", () => {
  it("re-calling with the same input returns the same result", () => {
    const input = baseInput({
      currentStage: "stage_1_auto_dial",
      elapsedSecondsSinceTrigger: 70,
    });
    const a = nextSOSStage(input);
    const b = nextSOSStage(input);
    expect(a).toEqual(b);
  });

  it("re-calling after a transition (current = next) is a no-op", () => {
    // Simulate the worker writing back the new stage and then
    // re-ticking before any time advanced — must NOT regress.
    const first = nextSOSStage(
      baseInput({ elapsedSecondsSinceTrigger: SOS_AUTO_DIAL_AFTER_SECONDS }),
    );
    expect(first.nextStage).toBe("stage_1_auto_dial");
    const second = nextSOSStage(
      baseInput({
        currentStage: "stage_1_auto_dial",
        elapsedSecondsSinceTrigger: SOS_AUTO_DIAL_AFTER_SECONDS,
      }),
    );
    expect(second.changed).toBe(false);
    expect(second.nextStage).toBe("stage_1_auto_dial");
  });
});

describe("nextSOSStage — never regresses (monotonic)", () => {
  const numericIndex: Record<SOSStage, number> = {
    stage_0_fullscreen: 0,
    stage_1_auto_dial: 1,
    stage_2_ivr_call: 2,
    stage_3_all_contacts: 3,
    resolved: 99,
    cancelled: 99,
  };

  it.each<SOSStage>([
    "stage_0_fullscreen",
    "stage_1_auto_dial",
    "stage_2_ivr_call",
    "stage_3_all_contacts",
  ])("%s never regresses across a sweep of input combinations", (currentStage) => {
    // Sweep every flag combination at a variety of elapsed times.
    const flagBits = [false, true];
    const elapseds = [0, 30, 60, 200, 300, 500, 600, 5000];
    for (const elapsed of elapseds) {
      for (const patientCancelled of flagBits) {
        for (const anyContactAnsweredCall of flagBits) {
          for (const resolved of flagBits) {
            for (const externallyCancelled of flagBits) {
              const result = nextSOSStage(
                baseInput({
                  currentStage,
                  elapsedSecondsSinceTrigger: elapsed,
                  patientCancelled,
                  anyContactAnsweredCall,
                  resolved,
                  externallyCancelled,
                }),
              );
              // The new stage either advances forward, jumps to a
              // terminal, or stays put — but never goes backward.
              const fromIdx = numericIndex[currentStage];
              const toIdx = numericIndex[result.nextStage];
              if (result.nextStage === "resolved" || result.nextStage === "cancelled") {
                // Terminal jump is always allowed.
                expect(true).toBe(true);
              } else {
                expect(toIdx).toBeGreaterThanOrEqual(fromIdx);
              }
            }
          }
        }
      }
    }
  });
});

describe("isSOSChainActive", () => {
  it.each<[SOSStage, boolean]>([
    ["stage_0_fullscreen", true],
    ["stage_1_auto_dial", true],
    ["stage_2_ivr_call", true],
    ["stage_3_all_contacts", true],
    ["resolved", false],
    ["cancelled", false],
  ])("%s → %s", (stage, active) => {
    expect(isSOSChainActive(stage)).toBe(active);
  });
});
