import { describe, expect, it } from "vitest";
import {
  classifySleep,
  SLEEP_FRAGMENT_AWAKE_MIN,
  SLEEP_LONG_MIN_MIN,
  SLEEP_SHORT_MAX_MIN,
  type SleepInput,
} from "./index.js";

// Build an input from a start time + in-bed hours + asleep minutes.
const night = (opts: {
  startHour?: number;
  inBedMinutes: number;
  durationMinutes: number;
}): SleepInput => {
  const start = new Date("2026-08-01T22:00:00.000Z");
  if (opts.startHour !== undefined) start.setUTCHours(opts.startHour);
  const end = new Date(start.getTime() + opts.inBedMinutes * 60_000);
  return { durationMinutes: opts.durationMinutes, sleepStart: start, sleepEnd: end };
};

describe("classifySleep", () => {
  it("classifies clearly insufficient sleep as short", () => {
    const c = classifySleep(night({ inBedMinutes: 300, durationMinutes: 290 }));
    expect(c.category).toBe("short");
    expect(c.reason).toContain("< 360");
  });

  it("just below the short threshold is short", () => {
    const c = classifySleep(night({ inBedMinutes: 360, durationMinutes: SLEEP_SHORT_MAX_MIN - 1 }));
    expect(c.category).toBe("short");
  });

  it("exactly the short threshold is NOT short (boundary is adequate)", () => {
    const c = classifySleep(night({ inBedMinutes: 360, durationMinutes: SLEEP_SHORT_MAX_MIN }));
    expect(c.category).toBe("adequate");
  });

  it("classifies oversleeping as long", () => {
    const c = classifySleep(night({ inBedMinutes: 620, durationMinutes: 600 }));
    expect(c.category).toBe("long");
    expect(c.reason).toContain("> 540");
  });

  it("just above the long threshold is long", () => {
    const c = classifySleep(night({ inBedMinutes: 600, durationMinutes: SLEEP_LONG_MIN_MIN + 1 }));
    expect(c.category).toBe("long");
  });

  it("exactly the long threshold is NOT long (boundary is adequate)", () => {
    const c = classifySleep(night({ inBedMinutes: 545, durationMinutes: SLEEP_LONG_MIN_MIN }));
    expect(c.category).toBe("adequate");
  });

  it("adequate duration with little wake time is adequate", () => {
    const c = classifySleep(night({ inBedMinutes: 460, durationMinutes: 450 }));
    expect(c.category).toBe("adequate");
    expect(c.awakeMinutes).toBe(10);
  });

  it("adequate duration but an hour+ awake in bed is fragmented", () => {
    const c = classifySleep(night({ inBedMinutes: 540, durationMinutes: 450 }));
    expect(c.category).toBe("fragmented");
    expect(c.awakeMinutes).toBe(90);
    expect(c.reason).toContain("awake in bed");
  });

  it("exactly the fragment threshold of awake time is fragmented", () => {
    const c = classifySleep(
      night({ inBedMinutes: 450 + SLEEP_FRAGMENT_AWAKE_MIN, durationMinutes: 450 }),
    );
    expect(c.category).toBe("fragmented");
    expect(c.awakeMinutes).toBe(SLEEP_FRAGMENT_AWAKE_MIN);
  });

  it("one minute under the fragment threshold stays adequate", () => {
    const c = classifySleep(
      night({ inBedMinutes: 450 + SLEEP_FRAGMENT_AWAKE_MIN - 1, durationMinutes: 450 }),
    );
    expect(c.category).toBe("adequate");
  });

  it("clamps awakeMinutes to 0 when the device over-counts asleep time", () => {
    // 400 min in bed but 450 min 'asleep' — impossible, clamp the gap.
    const c = classifySleep(night({ inBedMinutes: 400, durationMinutes: 450 }));
    expect(c.awakeMinutes).toBe(0);
    expect(c.category).toBe("adequate");
  });

  it("clamps in-bed span to 0 when sleepEnd precedes sleepStart (bad data)", () => {
    const start = new Date("2026-08-02T06:00:00.000Z");
    const end = new Date("2026-08-01T22:00:00.000Z"); // before start
    const c = classifySleep({ durationMinutes: 400, sleepStart: start, sleepEnd: end });
    expect(c.awakeMinutes).toBe(0);
    expect(c.category).toBe("adequate");
  });

  it("fragmentation is only judged inside the adequate band (short overrides)", () => {
    // 300 min asleep but 500 in bed (200 awake) → still 'short', not fragmented.
    const c = classifySleep(night({ inBedMinutes: 500, durationMinutes: 300 }));
    expect(c.category).toBe("short");
  });
});
