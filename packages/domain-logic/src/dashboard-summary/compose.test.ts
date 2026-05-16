import { describe, it, expect } from "vitest";

import { composeDashboardSummary } from "./compose.js";
import type {
  DashboardGlucoseReading,
  DashboardBpReading,
  DashboardSummaryInput,
} from "./types.js";

const NOW = new Date("2026-05-15T08:00:00.000Z");

const g = (
  value: number,
  type: DashboardGlucoseReading["readingType"] = "fasting",
  hoursAgo = 1,
): DashboardGlucoseReading => ({
  valueMgDl: value,
  readingType: type,
  measuredAt: new Date(NOW.getTime() - hoursAgo * 60 * 60_000).toISOString(),
});

const bp = (s: number, d: number, hoursAgo = 1): DashboardBpReading => ({
  systolic: s,
  diastolic: d,
  pulse: 72,
  measuredAt: new Date(NOW.getTime() - hoursAgo * 60 * 60_000).toISOString(),
});

const base = (overrides: Partial<DashboardSummaryInput> = {}): DashboardSummaryInput => ({
  todayGlucose: [],
  todayBp: [],
  yesterdayFasting: [],
  healthScore: null,
  currentStreakDays: 0,
  userStageDays: 14,
  language: "hi",
  ...overrides,
});

describe("composeDashboardSummary — cold start (< 7 days)", () => {
  it("returns welcome copy on day 0", () => {
    const result = composeDashboardSummary(base({ userStageDays: 0 }));
    expect(result.coldStart).toBe(true);
    expect(result.headline).toMatch(/Swagat hai/);
    expect(result.details).toHaveLength(0);
  });

  it("returns encouraging copy on day 1-6", () => {
    const result = composeDashboardSummary(base({ userStageDays: 3 }));
    expect(result.coldStart).toBe(true);
    expect(result.headline).toMatch(/3 din/);
  });

  it("never emits details during cold start, even with readings present", () => {
    const result = composeDashboardSummary(base({ userStageDays: 5, todayGlucose: [g(120)] }));
    expect(result.coldStart).toBe(true);
    expect(result.details).toHaveLength(0);
  });

  it("English copy honours the language flag", () => {
    const result = composeDashboardSummary(base({ userStageDays: 2, language: "en" }));
    expect(result.headline).toMatch(/2 days/);
  });
});

describe("composeDashboardSummary — no readings today", () => {
  it("gentle prompt with streak when one exists", () => {
    const result = composeDashboardSummary(base({ currentStreakDays: 5 }));
    expect(result.headline).toMatch(/5 din ki streak/);
  });

  it("plain prompt when no streak", () => {
    const result = composeDashboardSummary(base({ currentStreakDays: 0 }));
    expect(result.headline).toMatch(/pehli reading/);
  });
});

describe("composeDashboardSummary — critical values short-circuit", () => {
  it("low value fires safety sentence regardless of other readings", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(60), g(120, "post_meal")],
        todayBp: [bp(120, 80)],
      }),
    );
    expect(result.headline).toMatch(/bahut kam/);
    expect(result.details).toHaveLength(0);
  });

  it("high value fires safety sentence", () => {
    const result = composeDashboardSummary(base({ todayGlucose: [g(320, "post_meal")] }));
    expect(result.headline).toMatch(/bahut zyada/);
  });

  it("65 mg/dL is NOT critical (threshold is strictly < 65)", () => {
    const result = composeDashboardSummary(base({ todayGlucose: [g(65)] }));
    expect(result.headline).not.toMatch(/bahut kam/);
  });
});

describe("composeDashboardSummary — normal day", () => {
  it("headline includes health score when provided", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(118)],
        healthScore: {
          score: 82,
          components: { logging: 80, stability: 80, trend: 80, medication: 80, streak: 80 },
        },
      }),
    );
    expect(result.headline).toMatch(/Score 82\/100/);
  });

  it("headline omits score when null", () => {
    const result = composeDashboardSummary(base({ todayGlucose: [g(118)] }));
    expect(result.headline).not.toMatch(/Score/);
  });

  it("glucose detail uses the most-recent reading", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(180, "post_meal", 5), g(110, "fasting", 1)],
      }),
    );
    // Latest (1h ago) is fasting 110 → "thik hai"
    expect(result.details.join(" | ")).toMatch(/thik hai/);
    expect(result.details.join(" | ")).toMatch(/Fasting: 110/);
  });

  it("BP detail flags elevated systolic", () => {
    const result = composeDashboardSummary(
      base({ todayGlucose: [g(118)], todayBp: [bp(145, 88)] }),
    );
    expect(result.details.join(" | ")).toMatch(/BP thoda zyada \(145\/88\)/);
  });

  it("BP detail uses the most-recent reading when multiple exist today", () => {
    // Two BP readings today; the most recent should win.
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(118)],
        todayBp: [bp(150, 95, 6), bp(120, 78, 1)],
      }),
    );
    expect(result.details.join(" | ")).toMatch(/120\/78/);
    expect(result.details.join(" | ")).not.toMatch(/150\/95/);
  });

  it("trend line says 'kal se thoda zyada' when today is higher than yesterday", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(140, "fasting")],
        yesterdayFasting: [g(110, "fasting", 25)],
      }),
    );
    expect(result.details).toContain("Kal se thoda zyada");
  });

  it("trend line emits when both today and yesterday have fasting data", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(110, "fasting")],
        yesterdayFasting: [g(130, "fasting", 25)],
      }),
    );
    expect(result.details).toContain("Kal se behtar");
  });

  it("trend line is suppressed when yesterday is missing", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(110, "fasting")],
        yesterdayFasting: [],
      }),
    );
    expect(result.details.every((d) => !/Kal se|Yesterday/.test(d))).toBe(true);
  });

  it("trend line says 'kal jaisa hi' when delta < 10 mg/dL", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(115, "fasting")],
        yesterdayFasting: [g(112, "fasting", 25)],
      }),
    );
    expect(result.details).toContain("Kal jaisa hi");
  });
});

describe("composeDashboardSummary — English variant", () => {
  it("translates a normal-day summary", () => {
    const result = composeDashboardSummary(
      base({
        language: "en",
        todayGlucose: [g(118)],
        todayBp: [bp(122, 78)],
        yesterdayFasting: [g(130, "fasting", 25)],
        healthScore: {
          score: 78,
          components: { logging: 80, stability: 80, trend: 80, medication: 80, streak: 60 },
        },
      }),
    );
    expect(result.language).toBe("en");
    expect(result.headline).toMatch(/Today.*Score 78/);
    expect(result.details.some((d) => /Glucose.*Fasting: 118/.test(d))).toBe(true);
    expect(result.details.some((d) => /BP.*122\/78/.test(d))).toBe(true);
    expect(result.details).toContain("Better than yesterday");
  });

  it("translates a critical sentence", () => {
    const result = composeDashboardSummary(base({ language: "en", todayGlucose: [g(58)] }));
    expect(result.headline).toMatch(/Glucose very low.*58/);
    expect(result.headline).toMatch(/doctor/i);
  });

  it("English critical-high sentence", () => {
    const result = composeDashboardSummary(
      base({ language: "en", todayGlucose: [g(320, "post_meal")] }),
    );
    expect(result.headline).toMatch(/Glucose very high.*320/);
  });

  it("English no-readings prompt with streak", () => {
    const result = composeDashboardSummary(base({ language: "en", currentStreakDays: 5 }));
    expect(result.headline).toMatch(/5-day streak/);
  });

  it("English headline omits 'Score' when health-score is null", () => {
    const result = composeDashboardSummary(base({ language: "en", todayGlucose: [g(118)] }));
    expect(result.headline).toBe("Today");
  });

  it("English trend: 'similar to yesterday' when delta < 10", () => {
    const result = composeDashboardSummary(
      base({
        language: "en",
        todayGlucose: [g(115, "fasting")],
        yesterdayFasting: [g(112, "fasting", 25)],
      }),
    );
    expect(result.details).toContain("Similar to yesterday");
  });

  it("English trend: 'a bit higher than yesterday' when today rose", () => {
    const result = composeDashboardSummary(
      base({
        language: "en",
        todayGlucose: [g(140, "fasting")],
        yesterdayFasting: [g(110, "fasting", 25)],
      }),
    );
    expect(result.details).toContain("A bit higher than yesterday");
  });

  it("English BP detail flags elevated", () => {
    const result = composeDashboardSummary(
      base({ language: "en", todayGlucose: [g(118)], todayBp: [bp(145, 88)] }),
    );
    expect(result.details.some((d) => d.includes("BP a bit elevated"))).toBe(true);
  });

  it("English BP detail when looking good", () => {
    const result = composeDashboardSummary(
      base({ language: "en", todayGlucose: [g(118)], todayBp: [bp(120, 78)] }),
    );
    expect(result.details.some((d) => d.includes("BP looking good"))).toBe(true);
  });

  it("English glucose detail 'a bit low' under 80", () => {
    const result = composeDashboardSummary(base({ language: "en", todayGlucose: [g(72)] }));
    expect(result.details.some((d) => d.includes("Glucose a bit low"))).toBe(true);
  });

  it("English glucose detail 'a bit high' over 200", () => {
    const result = composeDashboardSummary(
      base({ language: "en", todayGlucose: [g(220, "post_meal")] }),
    );
    expect(result.details.some((d) => d.includes("Glucose a bit high"))).toBe(true);
  });

  it("Hindi glucose detail 'thoda kam' under 80", () => {
    const result = composeDashboardSummary(base({ todayGlucose: [g(72)] }));
    expect(result.details.some((d) => d.includes("Sugar thoda kam"))).toBe(true);
  });

  it("Hindi glucose detail 'thoda zyada' over 200", () => {
    const result = composeDashboardSummary(base({ todayGlucose: [g(220, "post_meal")] }));
    expect(result.details.some((d) => d.includes("Sugar thoda zyada"))).toBe(true);
  });

  it("Hindi BP detail 'thik hai' when normal", () => {
    const result = composeDashboardSummary(
      base({ todayGlucose: [g(118)], todayBp: [bp(118, 76)] }),
    );
    expect(result.details.some((d) => d.includes("BP thik hai"))).toBe(true);
  });

  it("English no-readings prompt without streak", () => {
    const result = composeDashboardSummary(base({ language: "en", currentStreakDays: 0 }));
    expect(result.headline).toBe("Log today's first reading?");
  });

  it("formats all glucose reading-type labels in Hindi", () => {
    const types = ["fasting", "post_meal", "pre_meal", "bedtime", "random"] as const;
    for (const t of types) {
      const result = composeDashboardSummary(base({ todayGlucose: [g(120, t)] }));
      const detail = result.details.join(" | ");
      const expected =
        t === "fasting"
          ? "Fasting"
          : t === "post_meal"
            ? "Post-meal"
            : t === "pre_meal"
              ? "Pre-meal"
              : t === "bedtime"
                ? "Soney se pehle"
                : "Random";
      expect(detail).toContain(expected);
    }
  });

  it("formats all glucose reading-type labels in English", () => {
    const types = ["fasting", "post_meal", "pre_meal", "bedtime", "random"] as const;
    for (const t of types) {
      const result = composeDashboardSummary(base({ language: "en", todayGlucose: [g(120, t)] }));
      const detail = result.details.join(" | ");
      const expected =
        t === "fasting"
          ? "Fasting"
          : t === "post_meal"
            ? "Post-meal"
            : t === "pre_meal"
              ? "Pre-meal"
              : t === "bedtime"
                ? "Bedtime"
                : "Random";
      expect(detail).toContain(expected);
    }
  });
});

describe("composeDashboardSummary — invariants", () => {
  it("headline is always non-empty", () => {
    const result = composeDashboardSummary(base());
    expect(result.headline.length).toBeGreaterThan(0);
  });

  it("returns at most 3 detail lines (glucose, BP, trend)", () => {
    const result = composeDashboardSummary(
      base({
        todayGlucose: [g(118, "fasting"), g(150, "post_meal", 2)],
        todayBp: [bp(122, 78)],
        yesterdayFasting: [g(130, "fasting", 25)],
      }),
    );
    expect(result.details.length).toBeLessThanOrEqual(3);
  });
});
