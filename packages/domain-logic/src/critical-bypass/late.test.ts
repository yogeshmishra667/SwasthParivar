import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isLateCriticalReading,
  LATE_CRITICAL_THRESHOLD_MINUTES,
  readingAgeAtSendMs,
} from "./late.js";

const at = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

const TAKEN = "2026-10-26T22:00:00.000Z";

describe("late critical reading (audit P33)", () => {
  it("the threshold is 2 hours", () => {
    expect(LATE_CRITICAL_THRESHOLD_MINUTES).toBe(120);
  });

  it("exactly 2 hours old is still current; a minute more is late", () => {
    const sent = (minutes: number) => ({
      measuredAtIso: TAKEN,
      sentAtIso: at(TAKEN, minutes),
      receivedAtIso: at(TAKEN, minutes),
    });
    expect(isLateCriticalReading(sent(120))).toBe(false);
    expect(isLateCriticalReading(sent(121))).toBe(true);
  });

  it("a reading sent at once is current", () => {
    expect(
      isLateCriticalReading({ measuredAtIso: TAKEN, sentAtIso: TAKEN, receivedAtIso: TAKEN }),
    ).toBe(false);
  });

  it("an overnight offline queue is late", () => {
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: at(TAKEN, 9 * 60),
        receivedAtIso: at(TAKEN, 9 * 60),
      }),
    ).toBe(true);
  });

  it("uses the device's own clock when it says when it sent: a clock 3h behind can't make a fresh reading late", () => {
    // Device clock 3h behind the server: taken and sent a minute apart.
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: at(TAKEN, 1),
        receivedAtIso: at(TAKEN, 3 * 60 + 1),
      }),
    ).toBe(false);
  });

  it("a queued reading is late even when the device clock is hours ahead", () => {
    expect(
      isLateCriticalReading({
        measuredAtIso: at(TAKEN, 5 * 60),
        sentAtIso: at(TAKEN, 5 * 60 + 8 * 60),
        receivedAtIso: at(TAKEN, 8 * 60),
      }),
    ).toBe(true);
  });

  it("an older app build (no sentAt) is aged by the server's receive time", () => {
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: null,
        receivedAtIso: at(TAKEN, 6 * 60),
      }),
    ).toBe(true);
    expect(
      isLateCriticalReading({ measuredAtIso: TAKEN, sentAtIso: null, receivedAtIso: at(TAKEN, 5) }),
    ).toBe(false);
  });

  it("a reading from the future is current", () => {
    expect(
      readingAgeAtSendMs({ measuredAtIso: at(TAKEN, 10), sentAtIso: TAKEN, receivedAtIso: TAKEN }),
    ).toBeLessThan(0);
    expect(
      isLateCriticalReading({
        measuredAtIso: at(TAKEN, 10),
        sentAtIso: TAKEN,
        receivedAtIso: TAKEN,
      }),
    ).toBe(false);
  });

  it("a time it can't read counts as current, never late", () => {
    expect(
      isLateCriticalReading({
        measuredAtIso: "not a date",
        sentAtIso: null,
        receivedAtIso: at(TAKEN, 10 * 60),
      }),
    ).toBe(false);
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: "garbage",
        receivedAtIso: at(TAKEN, 10 * 60),
      }),
    ).toBe(false);
  });

  it("property: late exactly when the same-clock age is over 2 hours", () => {
    fc.assert(
      fc.property(fc.integer({ min: -24 * 60, max: 7 * 24 * 60 }), (minutes) => {
        const late = isLateCriticalReading({
          measuredAtIso: TAKEN,
          sentAtIso: at(TAKEN, minutes),
          receivedAtIso: TAKEN,
        });
        expect(late).toBe(minutes > 120);
      }),
    );
  });
});
