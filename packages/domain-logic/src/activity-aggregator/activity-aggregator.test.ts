import { describe, expect, it } from "vitest";
import { dailyActivitySummary, type ActivityLog } from "./index.js";

const log = (over: Partial<ActivityLog> = {}): ActivityLog => ({
  date: "2026-08-01",
  steps: 1000,
  distanceMeters: 800,
  activeMinutes: 20,
  source: "healthkit",
  ...over,
});

describe("dailyActivitySummary", () => {
  it("returns an empty summary for no logs", () => {
    expect(dailyActivitySummary([])).toEqual({
      days: [],
      totalSteps: 0,
      totalDistanceMeters: 0,
      totalActiveMinutes: 0,
      dayCount: 0,
    });
  });

  it("passes a single row through unchanged", () => {
    const s = dailyActivitySummary([log({ steps: 5000, distanceMeters: 4000, activeMinutes: 45 })]);
    expect(s.dayCount).toBe(1);
    expect(s.days[0]).toEqual({
      date: "2026-08-01",
      steps: 5000,
      distanceMeters: 4000,
      activeMinutes: 45,
      source: "healthkit",
    });
    expect(s.totalSteps).toBe(5000);
    expect(s.totalDistanceMeters).toBe(4000);
    expect(s.totalActiveMinutes).toBe(45);
  });

  it("manual wins over a device row on the same day (device seen first)", () => {
    const s = dailyActivitySummary([
      log({ source: "healthkit", steps: 9000 }),
      log({ source: "manual", steps: 6000 }),
    ]);
    expect(s.dayCount).toBe(1);
    expect(s.days[0]!.source).toBe("manual");
    expect(s.days[0]!.steps).toBe(6000);
  });

  it("manual wins even when the device row is seen last", () => {
    const s = dailyActivitySummary([
      log({ source: "manual", steps: 6000 }),
      log({ source: "healthkit", steps: 9000 }),
    ]);
    expect(s.days[0]!.source).toBe("manual");
    expect(s.days[0]!.steps).toBe(6000);
  });

  it("does NOT sum steps across sources for the same day", () => {
    const s = dailyActivitySummary([
      log({ source: "manual", steps: 6000 }),
      log({ source: "healthkit", steps: 9000 }),
    ]);
    expect(s.totalSteps).toBe(6000); // manual only, not 15000
  });

  it("prefers healthkit over googlefit when no manual exists (deterministic)", () => {
    const s = dailyActivitySummary([
      log({ source: "googlefit", steps: 8000 }),
      log({ source: "healthkit", steps: 7000 }),
    ]);
    expect(s.days[0]!.source).toBe("healthkit");
    expect(s.days[0]!.steps).toBe(7000);
  });

  it("keeps the higher-ranked source even when it appears after a lower one", () => {
    // googlefit first, then healthkit (higher rank) → healthkit wins.
    const s = dailyActivitySummary([
      log({ source: "googlefit", steps: 8000 }),
      log({ source: "healthkit", steps: 7000 }),
      log({ source: "googlefit", steps: 8500 }),
    ]);
    expect(s.days[0]!.source).toBe("healthkit");
    expect(s.days[0]!.steps).toBe(7000);
  });

  it("breaks same-source ties by last-write (a refreshed row supersedes)", () => {
    const s = dailyActivitySummary([
      log({ source: "healthkit", steps: 7000 }),
      log({ source: "healthkit", steps: 7200 }),
    ]);
    expect(s.days[0]!.steps).toBe(7200);
  });

  it("aggregates multiple days and returns them ascending by date with totals", () => {
    const s = dailyActivitySummary([
      log({ date: "2026-08-03", steps: 3000, distanceMeters: 2000, activeMinutes: 30 }),
      log({ date: "2026-08-01", steps: 1000, distanceMeters: 800, activeMinutes: 10 }),
      log({ date: "2026-08-02", steps: 2000, distanceMeters: 1500, activeMinutes: 20 }),
    ]);
    expect(s.days.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(s.totalSteps).toBe(6000);
    expect(s.totalDistanceMeters).toBe(4300);
    expect(s.totalActiveMinutes).toBe(60);
    expect(s.dayCount).toBe(3);
  });

  it("dedups per-day independently across a multi-day mixed-source batch", () => {
    const s = dailyActivitySummary([
      log({ date: "2026-08-01", source: "healthkit", steps: 9000 }),
      log({ date: "2026-08-01", source: "manual", steps: 6000 }),
      log({ date: "2026-08-02", source: "googlefit", steps: 4000 }),
    ]);
    expect(s.dayCount).toBe(2);
    const byDate = new Map(s.days.map((d) => [d.date, d]));
    expect(byDate.get("2026-08-01")!.source).toBe("manual");
    expect(byDate.get("2026-08-02")!.source).toBe("googlefit");
    expect(s.totalSteps).toBe(10000); // 6000 + 4000
  });
});
