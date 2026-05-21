import { describe, expect, it } from "vitest";

import { shouldDispatchAlert } from "./alert-deduper.js";
import type { RecentAlertRecord } from "./types.js";

const NOW = new Date("2026-05-21T12:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

describe("shouldDispatchAlert", () => {
  it("yellow never pushes — daily summary only", () => {
    const r = shouldDispatchAlert({
      candidate: { severity: "yellow", type: "trend_concern" },
      recentAlertsThisWeek: [],
      now: NOW,
    });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain("daily summary");
  });

  it("orange with no prior alerts → dispatch", () => {
    const r = shouldDispatchAlert({
      candidate: { severity: "orange", type: "med_adherence" },
      recentAlertsThisWeek: [],
      now: NOW,
    });
    expect(r.dispatch).toBe(true);
  });

  it("orange with one prior orange this week → still dispatch (cap is 2)", () => {
    const recent: RecentAlertRecord[] = [{ severity: "orange", createdAt: daysAgo(2) }];
    expect(
      shouldDispatchAlert({
        candidate: { severity: "orange", type: "med_adherence" },
        recentAlertsThisWeek: recent,
        now: NOW,
      }).dispatch,
    ).toBe(true);
  });

  it("orange at the weekly cap of 2 → suppressed", () => {
    const recent: RecentAlertRecord[] = [
      { severity: "orange", createdAt: daysAgo(1) },
      { severity: "orange", createdAt: daysAgo(3) },
    ];
    const r = shouldDispatchAlert({
      candidate: { severity: "orange", type: "combined" },
      recentAlertsThisWeek: recent,
      now: NOW,
    });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain("weekly orange cap");
  });

  it("an orange older than 7 days does not count toward the cap", () => {
    const recent: RecentAlertRecord[] = [
      { severity: "orange", createdAt: daysAgo(8) },
      { severity: "orange", createdAt: daysAgo(10) },
    ];
    expect(
      shouldDispatchAlert({
        candidate: { severity: "orange", type: "trend_concern" },
        recentAlertsThisWeek: recent,
        now: NOW,
      }).dispatch,
    ).toBe(true);
  });

  it("yellow alerts in history do not count toward the orange cap", () => {
    const recent: RecentAlertRecord[] = [
      { severity: "yellow", createdAt: daysAgo(1) },
      { severity: "yellow", createdAt: daysAgo(2) },
      { severity: "orange", createdAt: daysAgo(3) },
    ];
    expect(
      shouldDispatchAlert({
        candidate: { severity: "orange", type: "med_adherence" },
        recentAlertsThisWeek: recent,
        now: NOW,
      }).dispatch,
    ).toBe(true);
  });
});
