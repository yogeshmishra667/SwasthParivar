import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { dueReminderWindows, REMINDER_OFFSETS_MS } from "./due-windows.js";
import type { SentReminderWindows } from "./types.js";

const NONE: SentReminderWindows = { "7d": false, "1d": false, "2h": false };

// Anchor "now" arithmetic to a fixed appointment time for readability.
const APPT = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01T12:00:00Z
const minutes = (n: number): number => n * 60 * 1000;
const hours = (n: number): number => n * 60 * minutes(1);
const days = (n: number): number => n * 24 * hours(1);

describe("dueReminderWindows — bucket boundaries", () => {
  it("fires nothing before the 7d bucket opens (too early)", () => {
    const now = APPT - days(10);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual([]);
  });

  it("fires 7d exactly at the 7d boundary (inclusive open)", () => {
    const now = APPT - days(7);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["7d"]);
  });

  it("fires 7d for an appointment booked only 3 days out (lands in 7d bucket)", () => {
    const now = APPT - days(3);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["7d"]);
  });

  it("fires 1d exactly at the 1d boundary (bucket is right-open, so 7d no longer fires)", () => {
    const now = APPT - days(1);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["1d"]);
  });

  it("fires 1d in the middle of the 1d bucket", () => {
    const now = APPT - hours(10);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["1d"]);
  });

  it("fires 2h exactly at the 2h boundary", () => {
    const now = APPT - hours(2);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["2h"]);
  });

  it("fires 2h up to the last minute before the appointment", () => {
    const now = APPT - minutes(1);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["2h"]);
  });

  it("fires nothing at or after the appointment time (past)", () => {
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: APPT, sent: NONE })).toEqual([]);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: APPT + hours(1), sent: NONE })).toEqual(
      [],
    );
  });

  it("for a last-minute booking (1h out) only the 2h reminder fires", () => {
    const now = APPT - hours(1);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["2h"]);
  });
});

describe("dueReminderWindows — sent-flag idempotency", () => {
  it("suppresses a window already marked sent", () => {
    const now = APPT - days(3); // 7d bucket
    expect(
      dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: { ...NONE, "7d": true } }),
    ).toEqual([]);
  });

  it("does not resurrect an earlier window once its bucket has passed", () => {
    // now is in the 1d bucket; even though 7d was never sent, it must
    // not fire late.
    const now = APPT - hours(5);
    expect(dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE })).toEqual(["1d"]);
  });

  it("fires the 2h reminder even if 7d and 1d were already sent", () => {
    const now = APPT - hours(1);
    expect(
      dueReminderWindows({
        scheduledAtMs: APPT,
        nowMs: now,
        sent: { "7d": true, "1d": true, "2h": false },
      }),
    ).toEqual(["2h"]);
  });
});

describe("dueReminderWindows — properties", () => {
  it("never returns more than one window (buckets are disjoint)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -days(20), max: days(1) }), (delta) => {
        const now = APPT + delta;
        const out = dueReminderWindows({ scheduledAtMs: APPT, nowMs: now, sent: NONE });
        return out.length <= 1;
      }),
    );
  });

  it("is idempotent — re-running with the same inputs yields the same result", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -days(20), max: days(1) }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (delta, s7, s1, s2) => {
          const args = {
            scheduledAtMs: APPT,
            nowMs: APPT + delta,
            sent: { "7d": s7, "1d": s1, "2h": s2 },
          };
          const a = dueReminderWindows(args);
          const b = dueReminderWindows(args);
          return JSON.stringify(a) === JSON.stringify(b);
        },
      ),
    );
  });

  it("never fires for a past appointment regardless of sent-flags", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: days(30) }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (ahead, s7, s1, s2) => {
          const out = dueReminderWindows({
            scheduledAtMs: APPT,
            nowMs: APPT + ahead,
            sent: { "7d": s7, "1d": s1, "2h": s2 },
          });
          return out.length === 0;
        },
      ),
    );
  });
});

describe("REMINDER_OFFSETS_MS", () => {
  it("exposes the three lead times in millis, coarse to fine", () => {
    expect(REMINDER_OFFSETS_MS["7d"]).toBe(days(7));
    expect(REMINDER_OFFSETS_MS["1d"]).toBe(days(1));
    expect(REMINDER_OFFSETS_MS["2h"]).toBe(hours(2));
  });
});
