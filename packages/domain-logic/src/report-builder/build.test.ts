import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildReportModel, ageToBand, REPORT_WATERMARK, REPORT_AI_SUMMARY_LABEL } from "./build.js";
import type { ReportModelInput } from "./types.js";

const base: ReportModelInput = {
  name: "Ramesh",
  age: 67,
  generatedAtIso: "2026-07-01T06:00:00.000Z",
  glucose: {
    fasting: [
      { iso: "2026-06-01T01:30:00Z", value: 120 },
      { iso: "2026-06-15T01:30:00Z", value: 110 },
      { iso: "2026-06-28T01:30:00Z", value: 130 },
    ],
    postMeal: [{ iso: "2026-06-20T08:00:00Z", value: 180 }],
  },
  bp: [
    { iso: "2026-06-10T02:00:00Z", systolic: 140, diastolic: 88 },
    { iso: "2026-06-25T02:00:00Z", systolic: 130, diastolic: 84 },
  ],
  hba1cEstimate: 6.8,
  medAdherencePercent: 92,
  insights: [
    { title: "Fasting trending up", severity: "moderate" },
    { title: "BP improved", severity: "low" },
  ],
  aiSummary: "Glucose control is reasonable; discuss morning readings.",
};

describe("buildReportModel — summaries", () => {
  it("summarises fasting glucose with avg/min/max/latest + raw values", () => {
    const m = buildReportModel(base);
    expect(m.glucose.fasting).toEqual({
      count: 3,
      latest: 130,
      min: 110,
      max: 130,
      avg: 120,
      values: [120, 110, 130],
    });
  });

  it("returns null for an empty series", () => {
    const m = buildReportModel({ ...base, glucose: { fasting: [], postMeal: [] } });
    expect(m.glucose.fasting).toBeNull();
    expect(m.glucose.postMeal).toBeNull();
  });

  it("summarises BP with latest + rounded averages", () => {
    const m = buildReportModel(base);
    expect(m.bp).toEqual({
      count: 2,
      latestSystolic: 130,
      latestDiastolic: 84,
      avgSystolic: 135,
      avgDiastolic: 86,
    });
  });

  it("returns null BP when there are no readings", () => {
    expect(buildReportModel({ ...base, bp: [] }).bp).toBeNull();
  });

  it("caps insights at 3", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `I${i}`, severity: "low" }));
    expect(buildReportModel({ ...base, insights: many }).insights).toHaveLength(3);
  });
});

describe("buildReportModel — safety (PII + labels)", () => {
  it("carries the patient name + age BAND only, never the exact age", () => {
    const m = buildReportModel(base);
    expect(m.patientName).toBe("Ramesh");
    expect(m.ageBand).toBe("60–69");
    // The exact age (67) must not appear anywhere in the serialised model.
    expect(JSON.stringify(m)).not.toContain("67");
  });

  it("always includes the watermark", () => {
    expect(buildReportModel(base).watermark).toBe(REPORT_WATERMARK);
  });

  it("labels the AI summary when present", () => {
    const m = buildReportModel(base);
    expect(m.aiSummary).toEqual({
      text: "Glucose control is reasonable; discuss morning readings.",
      label: REPORT_AI_SUMMARY_LABEL,
    });
  });

  it("omits the AI summary when null or blank", () => {
    expect(buildReportModel({ ...base, aiSummary: null }).aiSummary).toBeNull();
    expect(buildReportModel({ ...base, aiSummary: "   " }).aiSummary).toBeNull();
  });
});

describe("ageToBand", () => {
  it.each([
    [67, "60–69"],
    [60, "60–69"],
    [69, "60–69"],
    [70, "70–79"],
    [25, "20–29"],
    [5, "0–9"],
  ])("maps age %i to band %s", (age, band) => {
    expect(ageToBand(age)).toBe(band);
  });

  it("clamps invalid ages to the 0–9 band (total function)", () => {
    expect(ageToBand(0)).toBe("0–9");
    expect(ageToBand(-3)).toBe("0–9");
    expect(ageToBand(Number.NaN)).toBe("0–9");
  });
});

describe("buildReportModel — properties", () => {
  it("watermark + age-band invariants hold for any input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 120 }),
        (name, age) => {
          const m = buildReportModel({ ...base, name, age });
          return m.watermark === REPORT_WATERMARK && /^\d+–\d+$/.test(m.ageBand);
        },
      ),
    );
  });
});
