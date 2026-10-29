import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  criticalReadingTiming,
  isLateCriticalReading,
  LATE_CRITICAL_THRESHOLD_MINUTES,
  readingAgeAtSendMs,
} from "./late.js";

const at = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

const TAKEN = "2026-10-26T22:00:00.000Z";

/** Taken at TAKEN; sent `sentMin` later and received `receivedMin` later. */
const timing = (sentMin: number | null, receivedMin: number) =>
  criticalReadingTiming({
    measuredAtIso: TAKEN,
    sentAtIso: sentMin === null ? null : at(TAKEN, sentMin),
    receivedAtIso: at(TAKEN, receivedMin),
  });

describe("late critical reading (audit P33)", () => {
  it("the threshold is 2 hours", () => {
    expect(LATE_CRITICAL_THRESHOLD_MINUTES).toBe(120);
  });

  it("a reading sent at once is live and starts the cooldown", () => {
    expect(timing(0, 0)).toEqual({ late: false, startsCooldown: true, deviceAgeMs: 0 });
  });

  it("exactly 2 hours old is still live; a minute more is late", () => {
    expect(timing(120, 120)).toMatchObject({ late: false, startsCooldown: true });
    expect(timing(121, 121)).toMatchObject({ late: true, startsCooldown: false });
  });

  it("an overnight offline queue is late and doesn't start the cooldown", () => {
    expect(timing(9 * 60, 9 * 60)).toMatchObject({ late: true, startsCooldown: false });
  });

  it("a phone clock 3h behind can't make a fresh reading late (review B1)", () => {
    // Taken and sent a minute apart on the phone; the server sees 3h.
    expect(timing(1, 3 * 60 + 1)).toEqual({
      late: false,
      startsCooldown: true,
      deviceAgeMs: 60_000,
    });
  });

  it("without sentAt a reading is never late, whatever the server clock says (review B1)", () => {
    // A phone clock 6h behind on an older build looks exactly like this.
    expect(timing(null, 6 * 60)).toEqual({
      late: false,
      startsCooldown: false,
      deviceAgeMs: null,
    });
    expect(timing(null, 5)).toEqual({ late: false, startsCooldown: true, deviceAgeMs: null });
  });

  it("is late only when both clocks agree: a phone clock 3h ahead keeps an old reading live", () => {
    // Device age 4h, but the server sees only 1h: live, no cooldown.
    expect(timing(4 * 60, 60)).toMatchObject({ late: false, startsCooldown: false });
  });

  it("a reading from the future is live", () => {
    expect(
      readingAgeAtSendMs({ measuredAtIso: at(TAKEN, 10), sentAtIso: TAKEN, receivedAtIso: TAKEN }),
    ).toBeLessThan(0);
    expect(
      criticalReadingTiming({
        measuredAtIso: at(TAKEN, 10),
        sentAtIso: TAKEN,
        receivedAtIso: TAKEN,
      }),
    ).toMatchObject({ late: false, startsCooldown: true });
  });

  it("a time it can't read counts as current: live, cooldown on", () => {
    expect(
      criticalReadingTiming({
        measuredAtIso: "not a date",
        sentAtIso: at(TAKEN, 10 * 60),
        receivedAtIso: at(TAKEN, 10 * 60),
      }),
    ).toMatchObject({ late: false, startsCooldown: true });
    expect(
      criticalReadingTiming({
        measuredAtIso: TAKEN,
        sentAtIso: "garbage",
        receivedAtIso: at(TAKEN, 10 * 60),
      }),
    ).toMatchObject({ late: false });
  });

  it("isLateCriticalReading is the `late` answer", () => {
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: at(TAKEN, 300),
        receivedAtIso: at(TAKEN, 300),
      }),
    ).toBe(true);
    expect(
      isLateCriticalReading({
        measuredAtIso: TAKEN,
        sentAtIso: null,
        receivedAtIso: at(TAKEN, 300),
      }),
    ).toBe(false);
  });

  it("property: late ⇔ sentAt given and both ages over 2h; late never starts the cooldown", () => {
    const minutes = fc.integer({ min: -24 * 60, max: 7 * 24 * 60 });
    fc.assert(
      fc.property(fc.option(minutes, { nil: null }), minutes, (sent, received) => {
        const t = timing(sent, received);
        expect(t.late).toBe(sent !== null && sent > 120 && received > 120);
        if (t.late) expect(t.startsCooldown).toBe(false);
        if (sent === null) expect(t.late).toBe(false);
      }),
    );
  });
});
