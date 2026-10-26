// Unit tests for the notification i18n module. Tests both languages
// render correctly, params interpolate, unknown languages fall back to
// Hindi, and the profile-prefix helper uses the right honorific per
// language.

import { describe, expect, it } from "vitest";
import { notif, withProfilePrefix } from "./notifications.js";

describe("notif() — critical bypass copy", () => {
  it("Hindi low-sugar copy contains patient name + value + Hindi keyword", () => {
    const out = notif("critical_bypass_low", { patientName: "Rajesh", valueMgDl: 55 }, "hi");
    expect(out.title).toContain("Rajesh");
    expect(out.title).toContain("Bahut Kam");
    expect(out.body).toContain("55 mg/dL");
    expect(out.body).toContain("meetha");
  });

  it("English low-sugar copy contains patient name + value + English keyword", () => {
    const out = notif("critical_bypass_low", { patientName: "Rajesh", valueMgDl: 55 }, "en");
    expect(out.title).toContain("Rajesh");
    expect(out.title).toContain("Very Low");
    expect(out.body).toContain("55 mg/dL");
    expect(out.body).toContain("sweet");
  });

  it("Hindi high-sugar copy uses Hindi keyword", () => {
    const out = notif("critical_bypass_high", { patientName: "Priya", valueMgDl: 340 }, "hi");
    expect(out.title).toContain("Bahut Zyada");
    expect(out.body).toContain("340 mg/dL");
  });

  it("English high-sugar copy uses English keyword", () => {
    const out = notif("critical_bypass_high", { patientName: "Priya", valueMgDl: 340 }, "en");
    expect(out.title).toContain("Very High");
    expect(out.body).toContain("340 mg/dL");
    expect(out.body).toContain("Drink water");
  });
});

describe("notif() — BP critical bypass copy", () => {
  it.each([
    ["critical_bypass_bp_low", "hi", "BP Bahut Kam"],
    ["critical_bypass_bp_high", "hi", "BP Bahut Zyada"],
    ["critical_bypass_bp_low", "en", "BP Very Low"],
    ["critical_bypass_bp_high", "en", "BP Very High"],
  ] as const)("%s (%s) names the patient and both readings", (key, lang, title) => {
    const out = notif(key, { patientName: "Kamla", systolic: 192, diastolic: 118 }, lang);
    expect(out.title).toBe(`⚠️ Kamla: ${title}`);
    expect(out.body).toContain("192/118");
    // Tone rule: never "kharab"/"worse" — instructions, not alarm.
    expect(out.body.toLowerCase()).not.toMatch(/kharab|worse/);
  });
});

describe("notif() — re-engagement copy ramps gently by days", () => {
  it("Hindi day-2 uses 'din se reading nahi'", () => {
    const out = notif("re_engagement", { days: 2 }, "hi");
    expect(out.title).toContain("2 din se reading nahi");
  });

  it("Hindi day-4 shifts to 'Hum yaad kar rahe hain'", () => {
    const out = notif("re_engagement", { days: 4 }, "hi");
    expect(out.title).toBe("Hum yaad kar rahe hain");
    expect(out.body).toContain("4 din");
  });

  it("Hindi day-7 returns the welcome-back invitation (no guilt)", () => {
    const out = notif("re_engagement", { days: 7 }, "hi");
    expect(out.title).toBe("Wapas aane ka swagat hai");
    // Defensive: re-engagement must never include the words "missed"
    // or "skipped" in any form — explicit anti-guilt rule.
    expect(out.body.toLowerCase()).not.toContain("missed");
  });

  it("English day-1 pluralises correctly ('1 day' not '1 days')", () => {
    const out = notif("re_engagement", { days: 1 }, "en");
    expect(out.title).toContain("1 day without");
    expect(out.title).not.toContain("1 days");
  });

  it("English day-2 pluralises correctly ('2 days')", () => {
    const out = notif("re_engagement", { days: 2 }, "en");
    expect(out.title).toContain("2 days without");
  });

  it("English day-7 returns the welcome-back invitation", () => {
    const out = notif("re_engagement", { days: 7 }, "en");
    expect(out.title).toBe("Welcome back");
  });
});

describe("notif() — med reminder + streak risk + summary", () => {
  it("Hindi med reminder includes the medicine name", () => {
    const out = notif("med_reminder", { medicine: "Metformin 500mg" }, "hi");
    expect(out.title).toBe("Dawai ka time");
    expect(out.body).toContain("Metformin 500mg");
  });

  it("English med reminder includes the medicine name", () => {
    const out = notif("med_reminder", { medicine: "Metformin 500mg" }, "en");
    expect(out.title).toBe("Medicine time");
    expect(out.body).toContain("Metformin 500mg");
  });

  it("Hindi streak risk includes the streak number", () => {
    const out = notif("streak_risk", { streak: 14 }, "hi");
    expect(out.title).toContain("14 din ki streak");
  });

  it("English streak risk includes the streak number", () => {
    const out = notif("streak_risk", { streak: 14 }, "en");
    expect(out.title).toContain("14-day streak");
  });

  it("English guardian summary pluralises correctly", () => {
    expect(notif("daily_guardian_summary", { yellowCount: 1 }, "en").body).toContain("1 thing");
    expect(notif("daily_guardian_summary", { yellowCount: 3 }, "en").body).toContain("3 things");
  });
});

describe("notif() — fallback behaviour", () => {
  it("falls back to Hindi when the language enum is unknown", () => {
    // Cast through unknown to mimic a stale enum value reaching the
    // helper at runtime (e.g. a future language flag not yet bundled).
    const out = notif("best_time", undefined as never, "pa" as unknown as "hi");
    expect(out.body).toBe("Aaj ka log kar lein 🙏");
  });
});

describe("withProfilePrefix()", () => {
  it("returns the title unchanged when no profile name is given", () => {
    expect(withProfilePrefix("Dawai ka time", null, "hi")).toBe("Dawai ka time");
    expect(withProfilePrefix("Medicine time", null, "en")).toBe("Medicine time");
  });

  it("Hindi uses the honorific 'ji'", () => {
    expect(withProfilePrefix("Dawai ka time", "Ramesh", "hi")).toBe("Ramesh ji: Dawai ka time");
  });

  it("English uses a plain colon (no honorific)", () => {
    expect(withProfilePrefix("Medicine time", "Ramesh", "en")).toBe("Ramesh: Medicine time");
  });
});
