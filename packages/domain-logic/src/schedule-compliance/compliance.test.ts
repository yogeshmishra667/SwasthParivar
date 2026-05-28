import { describe, expect, it } from "vitest";

import { evaluateCompliance, _internals } from "./compliance.js";
import {
  COMPLIANCE_LATE_WINDOW_MINUTES,
  COMPLIANCE_ON_TIME_WINDOW_MINUTES,
  type EvaluateInput,
  type ReadingForCompliance,
  type ScheduledSlot,
  type ScheduleInput,
} from "./types.js";

// IST = UTC+5:30.
const IST = 330;
const PST = -480;

const dailyGlucoseSchedule = (
  overrides: Partial<ScheduleInput> & { slots?: ScheduledSlot[] } = {},
): ScheduleInput => ({
  id: "sched-1",
  checkType: "glucose",
  frequency: "daily",
  scheduledTimes: overrides.slots ?? [{ hour: 7, minute: 0 }],
  active: true,
  userTzOffsetMinutes: IST,
  ...overrides,
});

const reading = (
  measuredAtIso: string,
  overrides: Partial<ReadingForCompliance> = {},
): ReadingForCompliance => ({
  measuredAtIso,
  checkType: "glucose",
  ...overrides,
});

const evalInput = (
  partial: Partial<EvaluateInput> & { schedule?: ScheduleInput },
): EvaluateInput => ({
  schedule: partial.schedule ?? dailyGlucoseSchedule(),
  readings: partial.readings ?? [],
  windowStartIso: partial.windowStartIso ?? "2026-06-01T00:00:00.000Z",
  nowIso: partial.nowIso ?? "2026-06-08T00:00:00.000Z",
});

// ─────────────────────────────────────────────────────────────
// Slot expansion + timezone math
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — daily slot expansion", () => {
  it("expands a single daily slot once per day across a 7-day window", () => {
    const result = evaluateCompliance(
      evalInput({
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-08T00:00:00.000Z",
      }),
    );
    // 7AM IST = 01:30 UTC. From Jun-01 to Jun-08 → 7 slot occurrences
    // (Jun-01..Jun-07; Jun-08 01:30 UTC is *after* now=Jun-08 00:00,
    // so it is the nextDue rather than a past slot).
    expect(result.slots).toHaveLength(7);
    expect(result.slots[0]!.expectedAtIso).toBe("2026-06-01T01:30:00.000Z");
    expect(result.slots[6]!.expectedAtIso).toBe("2026-06-07T01:30:00.000Z");
    expect(result.nextDueAtIso).toBe("2026-06-08T01:30:00.000Z");
  });

  it("expands multiple daily slots per day", () => {
    const result = evaluateCompliance(
      evalInput({
        schedule: dailyGlucoseSchedule({
          slots: [
            { hour: 7, minute: 0 },
            { hour: 13, minute: 30 },
            { hour: 20, minute: 0 },
          ],
        }),
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    // 3 slots × 1 day (Jun-01) = 3 past slots; Jun-02 hour-7 is
    // the next due.
    expect(result.slots).toHaveLength(3);
    expect(result.slots.map((s) => s.expectedAtIso)).toEqual([
      "2026-06-01T01:30:00.000Z",
      "2026-06-01T08:00:00.000Z",
      "2026-06-01T14:30:00.000Z",
    ]);
    expect(result.nextDueAtIso).toBe("2026-06-02T01:30:00.000Z");
  });

  it("respects user timezone (negative offset)", () => {
    // 8 AM PST = 16:00 UTC.
    const result = evaluateCompliance(
      evalInput({
        schedule: dailyGlucoseSchedule({
          userTzOffsetMinutes: PST,
          slots: [{ hour: 8, minute: 0 }],
        }),
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.expectedAtIso).toBe("2026-06-01T16:00:00.000Z");
  });

  it("deduplicates identical slots", () => {
    const result = evaluateCompliance(
      evalInput({
        schedule: dailyGlucoseSchedule({
          slots: [
            { hour: 7, minute: 0 },
            { hour: 7, minute: 0 },
          ],
        }),
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots).toHaveLength(1);
  });

  it("returns no slots when schedule is inactive", () => {
    const result = evaluateCompliance(
      evalInput({ schedule: dailyGlucoseSchedule({ active: false }) }),
    );
    expect(result.slots).toHaveLength(0);
    expect(result.nextDueAtIso).toBeNull();
  });

  it("returns no slots when scheduledTimes is empty", () => {
    const result = evaluateCompliance(evalInput({ schedule: dailyGlucoseSchedule({ slots: [] }) }));
    expect(result.slots).toHaveLength(0);
    expect(result.nextDueAtIso).toBeNull();
  });
});

describe("evaluateCompliance — weekly slot expansion", () => {
  it("fires only on the matching weekday", () => {
    // 2026-06-01 is a Monday (dayOfWeek 1). 10 AM IST = 04:30 UTC.
    const result = evaluateCompliance(
      evalInput({
        schedule: {
          ...dailyGlucoseSchedule(),
          frequency: "weekly",
          scheduledTimes: [{ hour: 10, minute: 0, dayOfWeek: 1 }], // Monday
        },
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-15T00:00:00.000Z",
      }),
    );
    // Mondays in [Jun-01, Jun-15) → Jun-01 + Jun-08. Jun-15 04:30 UTC
    // is after now=00:00 → it's the nextDue.
    expect(result.slots.map((s) => s.expectedAtIso)).toEqual([
      "2026-06-01T04:30:00.000Z",
      "2026-06-08T04:30:00.000Z",
    ]);
    expect(result.nextDueAtIso).toBe("2026-06-15T04:30:00.000Z");
  });

  it("throws when a weekly slot is missing dayOfWeek", () => {
    expect(() =>
      evaluateCompliance(
        evalInput({
          schedule: {
            ...dailyGlucoseSchedule(),
            frequency: "weekly",
            scheduledTimes: [{ hour: 10, minute: 0 }],
          },
        }),
      ),
    ).toThrow(/dayOfWeek/);
  });
});

// ─────────────────────────────────────────────────────────────
// Matching: on_time / late / missed / pending
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — slot status", () => {
  it("on_time when reading is within ±60 min of expected", () => {
    // Slot: Jun-01 01:30 UTC. Reading at 01:45 UTC (15 min late) → on_time.
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T01:45:00.000Z", { id: "r1" })],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("on_time");
    expect(result.slots[0]!.matchedReadingId).toBe("r1");
    expect(result.slots[0]!.minutesLate).toBe(15);
    expect(result.onTimeCount).toBe(1);
  });

  it("on_time when reading is up to 60 min EARLY (within band)", () => {
    // Slot Jun-01 01:30 UTC. Reading at Jun-01 00:30 UTC (60 min early).
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T00:30:00.000Z")],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("on_time");
    expect(result.slots[0]!.minutesLate).toBe(-60);
  });

  it("late when reading is past the on_time window but inside late window", () => {
    // Slot Jun-01 01:30 UTC. Reading at 03:30 UTC = +120 min → late.
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T03:30:00.000Z")],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("late");
    expect(result.slots[0]!.minutesLate).toBe(120);
    expect(result.lateCount).toBe(1);
  });

  it("missed when no reading inside the late window AND now is past deadline", () => {
    // Slot Jun-01 01:30 UTC. Now is Jun-02 (way past +180 min deadline). No reading.
    const result = evaluateCompliance(
      evalInput({
        readings: [],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("missed");
    expect(result.missedCount).toBe(1);
  });

  it("pending when no reading AND now is still inside the late window", () => {
    // Slot Jun-01 01:30 UTC. Now is Jun-01 02:00 UTC (30 min after expected).
    const result = evaluateCompliance(
      evalInput({
        readings: [],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-01T02:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("pending");
    expect(result.pendingCount).toBe(1);
  });

  it("boundary: reading exactly 60 min after expected is on_time", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T02:30:00.000Z")], // slot + 60
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("on_time");
  });

  it("boundary: reading 61 min after expected is late", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T02:31:00.000Z")], // slot + 61
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("late");
  });

  it("boundary: reading exactly at the late edge (180 min) is late", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T04:30:00.000Z")], // slot + 180
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("late");
  });

  it("boundary: reading 181 min after expected does not match (slot missed)", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T04:31:00.000Z")], // slot + 181
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("missed");
  });
});

// ─────────────────────────────────────────────────────────────
// Multi-slot matching (greedy by slot order)
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — greedy multi-slot matching", () => {
  const twoSlots = dailyGlucoseSchedule({
    slots: [
      { hour: 7, minute: 0 }, // 01:30 UTC
      { hour: 13, minute: 0 }, // 07:30 UTC
    ],
  });

  it("two slots, two readings — each slot claims its own reading", () => {
    const result = evaluateCompliance(
      evalInput({
        schedule: twoSlots,
        readings: [
          reading("2026-06-01T01:35:00.000Z", { id: "morning" }),
          reading("2026-06-01T07:35:00.000Z", { id: "noon" }),
        ],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.matchedReadingId).toBe("morning");
    expect(result.slots[1]!.matchedReadingId).toBe("noon");
    expect(result.onTimeCount).toBe(2);
  });

  it("a reading can only claim one slot — second slot gets nothing", () => {
    // One reading near slot 1; slot 2 has no candidate.
    const result = evaluateCompliance(
      evalInput({
        schedule: twoSlots,
        readings: [reading("2026-06-01T01:35:00.000Z", { id: "morning" })],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("on_time");
    expect(result.slots[1]!.status).toBe("missed");
  });

  it("readings outside any slot window are ignored", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T20:00:00.000Z")], // way past slot + late
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("missed");
  });

  it("readings of a different check type are ignored", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("2026-06-01T01:35:00.000Z", { checkType: "bp" })],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("missed");
  });

  it("on_time wins over a later in-band candidate that would also match", () => {
    // Slot Jun-01 01:30 UTC. Two readings: 02:00 (on_time, +30) and
    // 03:30 (late, +120). Matcher should pick the on_time one.
    const result = evaluateCompliance(
      evalInput({
        readings: [
          reading("2026-06-01T02:00:00.000Z", { id: "onTime" }),
          reading("2026-06-01T03:30:00.000Z", { id: "late" }),
        ],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.matchedReadingId).toBe("onTime");
    expect(result.slots[0]!.status).toBe("on_time");
  });

  it("aggregate counts are correct across a mix of statuses", () => {
    // 3 slots on a single user-local day: on_time, late, missed.
    // nowIso is set late enough on Jun-01 UTC that the 18:00 IST
    // slot's late deadline has elapsed, but early enough that
    // tomorrow's 06:00 IST slot is not yet in the past-slot window.
    const schedule = dailyGlucoseSchedule({
      slots: [
        { hour: 6, minute: 0 }, // slot 1: 00:30 UTC
        { hour: 12, minute: 0 }, // slot 2: 06:30 UTC
        { hour: 18, minute: 0 }, // slot 3: 12:30 UTC
      ],
    });
    const result = evaluateCompliance(
      evalInput({
        schedule,
        readings: [
          reading("2026-06-01T00:40:00.000Z"), // slot 1: on_time
          reading("2026-06-01T08:00:00.000Z"), // slot 2: +90min late
        ],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-01T18:00:00.000Z",
      }),
    );
    expect(result.slots).toHaveLength(3);
    expect(result.onTimeCount).toBe(1);
    expect(result.lateCount).toBe(1);
    expect(result.missedCount).toBe(1);
    expect(result.pendingCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// next due
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — nextDueAtIso", () => {
  it("returns the next slot at or after now", () => {
    const result = evaluateCompliance(
      evalInput({
        nowIso: "2026-06-08T01:00:00.000Z",
      }),
    );
    // 7AM IST every day; Jun-08 01:30 UTC is the next due.
    expect(result.nextDueAtIso).toBe("2026-06-08T01:30:00.000Z");
  });

  it("returns the same-day slot if it has not yet passed", () => {
    const schedule = dailyGlucoseSchedule({
      slots: [
        { hour: 7, minute: 0 },
        { hour: 20, minute: 0 },
      ],
    });
    // 14:00 UTC is 19:30 IST — before the 20:00 IST evening slot.
    const result = evaluateCompliance(evalInput({ schedule, nowIso: "2026-06-08T14:00:00.000Z" }));
    expect(result.nextDueAtIso).toBe("2026-06-08T14:30:00.000Z");
  });

  it("returns null for an inactive schedule", () => {
    const result = evaluateCompliance(
      evalInput({ schedule: dailyGlucoseSchedule({ active: false }) }),
    );
    expect(result.nextDueAtIso).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Validation + error paths
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — input validation", () => {
  it("throws on invalid windowStartIso", () => {
    expect(() => evaluateCompliance(evalInput({ windowStartIso: "not-a-date" }))).toThrow(
      /windowStartIso/,
    );
  });

  it("throws on invalid nowIso", () => {
    expect(() => evaluateCompliance(evalInput({ nowIso: "garbage" }))).toThrow(/nowIso/);
  });

  it("throws on invalid slot hour", () => {
    expect(() =>
      evaluateCompliance(
        evalInput({ schedule: dailyGlucoseSchedule({ slots: [{ hour: 24, minute: 0 }] }) }),
      ),
    ).toThrow(/hour/);
  });

  it("throws on invalid slot minute", () => {
    expect(() =>
      evaluateCompliance(
        evalInput({ schedule: dailyGlucoseSchedule({ slots: [{ hour: 7, minute: 60 }] }) }),
      ),
    ).toThrow(/minute/);
  });

  it("throws on invalid weekly dayOfWeek", () => {
    expect(() =>
      evaluateCompliance(
        evalInput({
          schedule: {
            ...dailyGlucoseSchedule(),
            frequency: "weekly",
            scheduledTimes: [{ hour: 7, minute: 0, dayOfWeek: 9 }],
          },
        }),
      ),
    ).toThrow(/dayOfWeek/);
  });

  it("returns empty evaluation when windowStartIso is after nowIso", () => {
    // Defensive: caller curated a backwards window. We don't throw,
    // we just return nothing past + try to find nextDue anyway.
    const result = evaluateCompliance(
      evalInput({
        windowStartIso: "2026-06-08T00:00:00.000Z",
        nowIso: "2026-06-01T00:00:00.000Z",
      }),
    );
    expect(result.slots).toHaveLength(0);
    // nextDue scans forward from now (Jun-01) so it should still resolve.
    expect(result.nextDueAtIso).toBe("2026-06-01T01:30:00.000Z");
  });

  it("ignores readings with malformed measuredAtIso", () => {
    const result = evaluateCompliance(
      evalInput({
        readings: [reading("not-iso"), reading("2026-06-01T01:35:00.000Z")],
        windowStartIso: "2026-06-01T00:00:00.000Z",
        nowIso: "2026-06-02T00:00:00.000Z",
      }),
    );
    expect(result.slots[0]!.status).toBe("on_time");
  });
});

// ─────────────────────────────────────────────────────────────
// Internals (kept thin — most coverage comes from public path)
// ─────────────────────────────────────────────────────────────

describe("evaluateCompliance — internals", () => {
  it("expandSlots returns empty for backwards window", () => {
    expect(_internals.expandSlots(dailyGlucoseSchedule(), 100, 50)).toEqual([]);
  });

  it("findNextDueMs returns null when schedule has no future slots in the lookahead window", () => {
    // An empty-scheduledTimes schedule has no slots at all → null.
    expect(_internals.findNextDueMs(dailyGlucoseSchedule({ slots: [] }), Date.now())).toBeNull();
  });

  it("exports the documented window constants", () => {
    expect(COMPLIANCE_ON_TIME_WINDOW_MINUTES).toBe(60);
    expect(COMPLIANCE_LATE_WINDOW_MINUTES).toBe(180);
  });
});
