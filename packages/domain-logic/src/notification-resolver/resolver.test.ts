import { describe, expect, it } from "vitest";
import type { NotificationCandidate, NotificationState } from "@swasth/shared-types";
import { recordIgnored, recoverFatigueOn2DayLogStreak, resolveNotification } from "./resolver.js";

const baseState: NotificationState = {
  userId: "u1",
  fatigueLevel: 0,
  consecutiveIgnores: 0,
  lastNotificationAt: null,
  bestLogTimeFasting: "07:00",
  bestLogTimePostMeal: "13:30",
  notificationHistory7d: [],
  last3VariantIds: [],
};

const cand = (over: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  trigger: "best_time",
  messageKey: "morning.v1",
  scheduledFor: "2026-04-15T07:00:00.000Z",
  params: {},
  ...over,
});

describe("notification priority", () => {
  it("critical fires even at max fatigue", () => {
    const r = resolveNotification({
      state: { ...baseState, fatigueLevel: 3 },
      candidates: [cand(), cand({ trigger: "critical_low_high", messageKey: "crit.low" })],
      nowIso: "2026-04-15T07:00:00.000Z",
    });
    expect(r.kind).toBe("send");
    if (r.kind === "send") expect(r.chosen.trigger).toBe("critical_low_high");
  });

  it("highest priority chosen among multiple", () => {
    const r = resolveNotification({
      state: baseState,
      candidates: [cand({ trigger: "generic_morning" }), cand({ trigger: "streak_risk" })],
      nowIso: "2026-04-15T07:00:00.000Z",
    });
    if (r.kind === "send") expect(r.chosen.trigger).toBe("streak_risk");
  });
});

describe("notification suppression", () => {
  it("duplicate messageKey within 24h → suppressed", () => {
    const r = resolveNotification({
      state: {
        ...baseState,
        notificationHistory7d: [
          { at: "2026-04-15T06:00:00.000Z", type: "best_time", messageKey: "morning.v1" },
        ],
      },
      candidates: [cand()],
      nowIso: "2026-04-15T07:00:00.000Z",
    });
    expect(r.kind).toBe("suppress");
  });

  it("fatigue level 3 → stop all non-critical", () => {
    const r = resolveNotification({
      state: { ...baseState, fatigueLevel: 3 },
      candidates: [cand()],
      nowIso: "2026-04-15T07:00:00.000Z",
    });
    expect(r.kind).toBe("suppress");
  });
});

describe("fatigue accounting", () => {
  it("3 ignores → fatigue level 1", () => {
    let s = baseState;
    for (let i = 0; i < 3; i++) s = recordIgnored(s);
    expect(s.fatigueLevel).toBe(1);
  });

  it("7 ignores → fatigue level 3", () => {
    let s = baseState;
    for (let i = 0; i < 7; i++) s = recordIgnored(s);
    expect(s.fatigueLevel).toBe(3);
  });

  it("2 consecutive log days resets fatigue", () => {
    const s = recoverFatigueOn2DayLogStreak(
      { ...baseState, fatigueLevel: 2, consecutiveIgnores: 5 },
      2,
    );
    expect(s.fatigueLevel).toBe(0);
    expect(s.consecutiveIgnores).toBe(0);
  });
});
