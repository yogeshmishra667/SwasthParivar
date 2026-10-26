import { describe, expect, it } from "vitest";
import type { NotificationCandidate, NotificationState } from "@swasth/shared-types";
import {
  IGNORED_AFTER_MS,
  countIgnoredNotifications,
  recordIgnored,
  recordNotificationOpened,
  recoverFatigueOn2DayLogStreak,
  resolveNotification,
} from "./resolver.js";

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

// Audit P11 — CLAUDE.md "Anti-Fatigue": max 2 non-medicine pushes a day;
// 3 ignores → 1/day; 5 → every other day; 7 → stop.
const NOW = "2026-04-15T20:00:00.000Z";
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
const sent = (
  h: number,
  type: NotificationState["notificationHistory7d"][number]["type"] = "best_time",
) => ({
  at: hoursAgo(h),
  type,
  messageKey: `k.${type}.${h}`,
});
const resolveAt = (state: NotificationState) =>
  resolveNotification({
    state,
    candidates: [cand({ trigger: "missed_day", messageKey: "notification.missed_day_d1" })],
    nowIso: NOW,
  });

describe("daily cap by fatigue level (audit P11)", () => {
  it("level 0: a 3rd push in 24h is suppressed; 2 are fine", () => {
    expect(resolveAt({ ...baseState, notificationHistory7d: [sent(10)] }).kind).toBe("send");
    expect(resolveAt({ ...baseState, notificationHistory7d: [sent(10), sent(5)] })).toMatchObject({
      kind: "suppress",
      reason: "fatigue_max_per_day",
    });
  });

  it("level 1 (3 ignores): a 2nd push in 24h is suppressed", () => {
    const state = { ...baseState, fatigueLevel: 1 as const };
    expect(resolveAt({ ...state, notificationHistory7d: [sent(25)] }).kind).toBe("send");
    expect(resolveAt({ ...state, notificationHistory7d: [sent(10)] })).toMatchObject({
      kind: "suppress",
      reason: "fatigue_max_per_day",
    });
  });

  it("level 2 (5 ignores): every other day — one push 30h ago still suppresses, 49h ago doesn't", () => {
    const state = { ...baseState, fatigueLevel: 2 as const };
    expect(resolveAt({ ...state, notificationHistory7d: [sent(30)] }).kind).toBe("suppress");
    expect(resolveAt({ ...state, notificationHistory7d: [sent(49)] }).kind).toBe("send");
  });

  it("level 3 (7 ignores): stop", () => {
    expect(resolveAt({ ...baseState, fatigueLevel: 3 })).toMatchObject({
      kind: "suppress",
      reason: "fatigue_stop",
    });
  });

  it("medicine reminders and critical alerts never use up the cap", () => {
    const history = [
      sent(10, "med_reminder"),
      sent(9, "med_reminder"),
      sent(8, "critical_low_high"),
    ];
    expect(resolveAt({ ...baseState, notificationHistory7d: history }).kind).toBe("send");
  });

  it("records the push id in history so its open can be matched", () => {
    const r = resolveNotification({
      state: baseState,
      candidates: [cand()],
      nowIso: NOW,
      notificationId: "n-1",
    });
    expect(r.kind === "send" && r.nextState.notificationHistory7d.at(-1)?.notificationId).toBe(
      "n-1",
    );
    const critical = resolveNotification({
      state: baseState,
      candidates: [cand({ trigger: "critical_low_high", messageKey: "crit" })],
      nowIso: NOW,
      notificationId: "n-2",
    });
    expect(
      critical.kind === "send" && critical.nextState.notificationHistory7d.at(-1)?.notificationId,
    ).toBe("n-2");
  });

  it("without an id the history entry has none (callers that don't track opens)", () => {
    const r = resolveNotification({ state: baseState, candidates: [cand()], nowIso: NOW });
    expect(r.kind === "send" && "notificationId" in r.nextState.notificationHistory7d.at(-1)!).toBe(
      false,
    );
  });
});

describe("ignored pushes (audit P11)", () => {
  const withId = (h: number, id: string, extra: object = {}) => ({
    ...sent(h),
    notificationId: id,
    ...extra,
  });

  it("an unopened push counts as ignored after IGNORED_AFTER_MS, once", () => {
    const hours = IGNORED_AFTER_MS / 3_600_000;
    const state = {
      ...baseState,
      notificationHistory7d: [withId(hours + 1, "a"), withId(hours - 1, "b")],
    };
    const first = countIgnoredNotifications(state, NOW);
    expect(first.ignored).toEqual(["best_time"]);
    expect(first.state.consecutiveIgnores).toBe(1);
    expect(first.state.notificationHistory7d[0]!.ignoredAt).toBe(NOW);
    const again = countIgnoredNotifications(first.state, NOW);
    expect(again.ignored).toEqual([]);
    expect(again.state.consecutiveIgnores).toBe(1);
  });

  it("3 ignored pushes → fatigue level 1", () => {
    const state = {
      ...baseState,
      notificationHistory7d: [withId(30, "a"), withId(20, "b"), withId(10, "c")],
    };
    const r = countIgnoredNotifications(state, NOW);
    expect(r.state).toMatchObject({ consecutiveIgnores: 3, fatigueLevel: 1 });
  });

  it("opened pushes, medicine reminders, critical alerts and id-less (old) entries never count", () => {
    const state = {
      ...baseState,
      notificationHistory7d: [
        withId(10, "a", { openedAt: hoursAgo(9) }),
        { ...sent(10, "med_reminder"), notificationId: "m" },
        { ...sent(10, "critical_low_high"), notificationId: "c" },
        sent(10),
      ],
    };
    const r = countIgnoredNotifications(state, NOW);
    expect(r.ignored).toEqual([]);
    expect(r.state.consecutiveIgnores).toBe(0);
  });

  it("an opened push resets fatigue and is never counted as ignored", () => {
    const state: NotificationState = {
      ...baseState,
      fatigueLevel: 2,
      consecutiveIgnores: 5,
      notificationHistory7d: [withId(10, "a"), withId(9, "b")],
    };
    const opened = recordNotificationOpened(state, "a", hoursAgo(8));
    expect(opened).toMatchObject({ fatigueLevel: 0, consecutiveIgnores: 0 });
    expect(opened.notificationHistory7d[0]!.openedAt).toBe(hoursAgo(8));
    expect(opened.notificationHistory7d[1]!.openedAt).toBeUndefined();
    expect(countIgnoredNotifications(opened, NOW).ignored).toEqual(["best_time"]);
  });

  it("an open for a push not in history changes nothing", () => {
    const state = { ...baseState, fatigueLevel: 3 as const, consecutiveIgnores: 7 };
    expect(recordNotificationOpened(state, "unknown", NOW)).toBe(state);
  });

  it("opening a medicine reminder or a critical alert doesn't reset habit fatigue", () => {
    const state: NotificationState = {
      ...baseState,
      fatigueLevel: 2,
      consecutiveIgnores: 5,
      notificationHistory7d: [
        { ...sent(5, "med_reminder"), notificationId: "m" },
        { ...sent(4, "critical_low_high"), notificationId: "c" },
      ],
    };
    expect(recordNotificationOpened(state, "m", NOW)).toBe(state);
    expect(recordNotificationOpened(state, "c", NOW)).toBe(state);
  });

  it("an open that arrives after the push was counted ignored still resets fatigue", () => {
    const counted = countIgnoredNotifications(
      { ...baseState, notificationHistory7d: [withId(30, "a"), withId(20, "b"), withId(10, "c")] },
      NOW,
    ).state;
    expect(counted.fatigueLevel).toBe(1);
    const opened = recordNotificationOpened(counted, "c", NOW);
    expect(opened).toMatchObject({ fatigueLevel: 0, consecutiveIgnores: 0 });
    expect(opened.notificationHistory7d[2]!.openedAt).toBe(NOW);
  });

  it("a second open of the same push keeps its first openedAt", () => {
    const state = {
      ...baseState,
      notificationHistory7d: [withId(10, "a", { openedAt: hoursAgo(9) })],
    };
    expect(recordNotificationOpened(state, "a", NOW).notificationHistory7d[0]!.openedAt).toBe(
      hoursAgo(9),
    );
  });
});

describe("cap windows and thresholds (audit P11 review)", () => {
  const minsAgo = (m: number): string => new Date(Date.parse(NOW) - m * 60_000).toISOString();
  const at = (iso: string) => ({ at: iso, type: "missed_day" as const, messageKey: `k.${iso}` });

  it("cron jitter can't turn '1 a day' into every other day: yesterday's push 23h59m ago allows today's", () => {
    const state = { ...baseState, fatigueLevel: 1 as const };
    expect(resolveAt({ ...state, notificationHistory7d: [at(minsAgo(23 * 60 + 59))] }).kind).toBe(
      "send",
    );
    expect(resolveAt({ ...state, notificationHistory7d: [at(minsAgo(23 * 60))] }).kind).toBe(
      "suppress",
    );
  });

  it("every other day: 47h50m after the last push is allowed, 47h is not", () => {
    const state = { ...baseState, fatigueLevel: 2 as const };
    expect(resolveAt({ ...state, notificationHistory7d: [at(minsAgo(47 * 60 + 50))] }).kind).toBe(
      "send",
    );
    expect(resolveAt({ ...state, notificationHistory7d: [at(minsAgo(47 * 60))] }).kind).toBe(
      "suppress",
    );
  });

  it("an out-of-range fatigue level stops (fails safe)", () => {
    expect(
      resolveAt({ ...baseState, fatigueLevel: 4 as unknown as NotificationState["fatigueLevel"] }),
    ).toMatchObject({ kind: "suppress", reason: "fatigue_stop" });
  });

  it("a push exactly IGNORED_AFTER_MS old counts as ignored; 1ms younger doesn't", () => {
    const entry = (ms: number) => ({
      at: new Date(Date.parse(NOW) - ms).toISOString(),
      type: "missed_day" as const,
      messageKey: "k",
      notificationId: `id-${ms}`,
    });
    const r = countIgnoredNotifications(
      {
        ...baseState,
        notificationHistory7d: [entry(IGNORED_AFTER_MS), entry(IGNORED_AFTER_MS - 1)],
      },
      NOW,
    );
    expect(r.ignored).toHaveLength(1);
    expect(r.state.notificationHistory7d[1]!.ignoredAt).toBeUndefined();
  });

  it.each([
    [5, 2],
    [7, 3],
  ])("%i pushes ignored in one tick → fatigue level %i", (n, level) => {
    const history = Array.from({ length: n }, (_, i) => ({
      at: hoursAgo(10 + i),
      type: "missed_day" as const,
      messageKey: `k${i}`,
      notificationId: `id${i}`,
    }));
    expect(
      countIgnoredNotifications({ ...baseState, notificationHistory7d: history }, NOW).state
        .fatigueLevel,
    ).toBe(level);
  });
});
