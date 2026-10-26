// Audit P3 — one app-wide fullscreen critical alert.
import { criticalReasonKey, useCriticalAlertStore } from "@/stores/critical-alert.store";

const reset = (): void => {
  useCriticalAlertStore.setState({
    current: null,
    queue: [],
    lastLocalRaise: {},
    shownReadingIds: [],
  });
};

beforeEach(() => {
  reset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const glucose = { audience: "patient" as const, userId: "maa", category: "glucose" as const };

describe("critical alert store", () => {
  it("a local raise always shows, even right after another", () => {
    useCriticalAlertStore.getState().raise({ ...glucose, valueLabel: "48 mg/dL" });
    useCriticalAlertStore.getState().dismiss();
    useCriticalAlertStore.getState().raise({ ...glucose, valueLabel: "45 mg/dL" });
    expect(useCriticalAlertStore.getState().current?.valueLabel).toBe("45 mg/dL");
  });

  it("a push that echoes a local alert (same profile and category) is not shown again", () => {
    useCriticalAlertStore.getState().raise(glucose);
    useCriticalAlertStore.getState().dismiss();
    useCriticalAlertStore.getState().raiseFromPush(glucose, "r1");
    expect(useCriticalAlertStore.getState().current).toBeNull();
  });

  it("a push for another category, or after the echo window, is shown", () => {
    useCriticalAlertStore.getState().raise(glucose);
    useCriticalAlertStore.getState().dismiss();
    useCriticalAlertStore.getState().raiseFromPush({ ...glucose, category: "bp" }, "r2");
    expect(useCriticalAlertStore.getState().current?.category).toBe("bp");
    useCriticalAlertStore.getState().dismiss();
    jest.advanceTimersByTime(11 * 60_000);
    useCriticalAlertStore.getState().raiseFromPush(glucose, "r3");
    expect(useCriticalAlertStore.getState().current?.category).toBe("glucose");
  });

  it("the same reading's push (foreground, then tapped) shows once", () => {
    useCriticalAlertStore.getState().raiseFromPush(glucose, "r4");
    useCriticalAlertStore.getState().dismiss();
    useCriticalAlertStore.getState().raiseFromPush(glucose, "r4");
    expect(useCriticalAlertStore.getState().current).toBeNull();
  });

  it("a guardian alert is never suppressed as a local echo", () => {
    useCriticalAlertStore.getState().raise({ ...glucose, userId: null });
    useCriticalAlertStore.getState().dismiss();
    useCriticalAlertStore
      .getState()
      .raiseFromPush({ audience: "guardian", userId: null, category: "glucose" }, "r5");
    expect(useCriticalAlertStore.getState().current?.audience).toBe("guardian");
  });
});

describe("critical alert queue (review C2)", () => {
  const guardian = {
    audience: "guardian" as const,
    userId: null,
    category: "glucose" as const,
    patientId: "ramesh-ji",
  };

  it("a guardian alert never covers the patient's own: it waits, then shows", () => {
    useCriticalAlertStore.getState().raise(glucose);
    useCriticalAlertStore.getState().raiseFromPush(guardian, "g1");
    expect(useCriticalAlertStore.getState().current?.audience).toBe("patient");
    useCriticalAlertStore.getState().dismiss();
    expect(useCriticalAlertStore.getState().current?.audience).toBe("guardian");
    useCriticalAlertStore.getState().dismiss();
    expect(useCriticalAlertStore.getState().current).toBeNull();
  });

  it("the patient's alert comes before a guardian alert already up", () => {
    useCriticalAlertStore.getState().raiseFromPush(guardian, "g2");
    useCriticalAlertStore.getState().raise(glucose);
    expect(useCriticalAlertStore.getState().current?.audience).toBe("patient");
    useCriticalAlertStore.getState().dismiss();
    expect(useCriticalAlertStore.getState().current?.audience).toBe("guardian");
  });

  it("on a shared phone, Maa's alert doesn't erase Papa's: it shows after (review W8)", () => {
    useCriticalAlertStore.getState().raise({ ...glucose, userId: "papa" });
    useCriticalAlertStore.getState().raise({ ...glucose, userId: "maa", category: "bp" });
    expect(useCriticalAlertStore.getState().current).toMatchObject({ userId: "maa" });
    useCriticalAlertStore.getState().dismiss();
    expect(useCriticalAlertStore.getState().current).toMatchObject({ userId: "papa" });
  });

  it("a newer reading of the same profile and category replaces the alert", () => {
    useCriticalAlertStore.getState().raise({ ...glucose, valueLabel: "48 mg/dL" });
    useCriticalAlertStore.getState().raise({ ...glucose, valueLabel: "44 mg/dL" });
    useCriticalAlertStore.getState().dismiss();
    expect(useCriticalAlertStore.getState().current).toBeNull();
  });

  it("every alert gets a new id, so the modal starts over", () => {
    useCriticalAlertStore.getState().raise(glucose);
    const first = useCriticalAlertStore.getState().current?.id;
    useCriticalAlertStore.getState().raise({ ...glucose, category: "bp" });
    expect(useCriticalAlertStore.getState().current?.id).not.toBe(first);
  });
});

describe("criticalReasonKey", () => {
  it.each([
    ["critical.hr_low", "hr_low"],
    ["critical.cardiac.hr_low", "hr_low"],
    ["critical.chest_pain_severe", "chest_pain"],
    ["critical.cardiac.chest_pain", "chest_pain"],
    ["critical.peak_flow_red_zone", "peak_flow"],
    ["critical.respiratory.severe_symptom", "severe_symptom"],
    ["something.new", "generic"],
    [undefined, "generic"],
  ])("%s → %s", (input, key) => {
    expect(criticalReasonKey(input)).toBe(key);
  });
});
