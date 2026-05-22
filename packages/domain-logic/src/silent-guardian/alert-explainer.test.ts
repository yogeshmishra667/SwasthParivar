import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildAlertContent, classifyAlertType } from "./alert-explainer.js";
import type { AlertContentSignal, AlertLanguage } from "./types.js";

const medSignal = (evidence: Record<string, unknown>): AlertContentSignal => ({
  source: "med_adherence",
  signalType: "med_missed_frequent",
  rawEvidence: evidence,
});

const anomalySignal = (evidence: Record<string, unknown>): AlertContentSignal => ({
  source: "data_anomaly",
  signalType: "worsening_trend",
  rawEvidence: evidence,
});

describe("classifyAlertType", () => {
  it("med-only → med_adherence", () => {
    expect(classifyAlertType([{ source: "med_adherence" }])).toBe("med_adherence");
  });

  it("anomaly-only → trend_concern", () => {
    expect(classifyAlertType([{ source: "data_anomaly" }])).toBe("trend_concern");
  });

  it("both → combined", () => {
    expect(classifyAlertType([{ source: "med_adherence" }, { source: "data_anomaly" }])).toBe(
      "combined",
    );
  });

  it("empty → trend_concern (degenerate; the service never calls it this way)", () => {
    expect(classifyAlertType([])).toBe("trend_concern");
  });
});

describe("buildAlertContent — med_adherence", () => {
  it("Hinglish copy interpolates the patient name and missed count", () => {
    const out = buildAlertContent({
      signals: [medSignal({ missedCount: 3, windowDays: 7 })],
      patientName: "Ramesh ji",
      language: "hi",
    });
    expect(out.title).toBe("Dawai chhoot rahi hai");
    expect(out.summary).toContain("Ramesh ji");
    expect(out.summary).toContain("3");
    expect(out.explanation).toContain("7");
    expect(out.suggestedAction).toContain("Phone");
  });

  it("English copy resolves from language 'en'", () => {
    const out = buildAlertContent({
      signals: [medSignal({ missedCount: 2, windowDays: 5 })],
      patientName: "Ramesh",
      language: "en",
    });
    expect(out.title).toBe("Medication is being missed");
    expect(out.explanation).toContain("5 days");
    expect(out.explanation).toContain("2 time(s)");
  });

  it("missing windowDays falls back to a 7-day window; ≤ 0 is ignored too", () => {
    const dflt = buildAlertContent({
      signals: [medSignal({ missedCount: 1 })],
      patientName: "A",
      language: "en",
    });
    expect(dflt.explanation).toContain("7 days");
    const zero = buildAlertContent({
      signals: [medSignal({ missedCount: 1, windowDays: 0 })],
      patientName: "A",
      language: "en",
    });
    expect(zero.explanation).toContain("7 days");
  });

  it("missing missedCount → counted as 0", () => {
    const out = buildAlertContent({
      signals: [medSignal({})],
      patientName: "A",
      language: "en",
    });
    expect(out.explanation).toContain("0 time(s)");
  });
});

describe("buildAlertContent — trend_concern", () => {
  it("Hinglish copy names the reading type and slope", () => {
    const out = buildAlertContent({
      signals: [anomalySignal({ slopePerDay: 4, readingType: "fasting" })],
      patientName: "Sushila ji",
      language: "hi-en",
    });
    expect(out.title).toBe("Sugar badh raha hai");
    expect(out.summary).toContain("Sushila ji");
    expect(out.summary).toContain("khaali-pet");
    expect(out.explanation).toContain("4");
  });

  it("maps reading types to fixed words, unknown → generic", () => {
    const fasting = buildAlertContent({
      signals: [anomalySignal({ slopePerDay: 3, readingType: "fasting" })],
      patientName: "A",
      language: "en",
    });
    expect(fasting.summary).toContain("fasting");

    const postMeal = buildAlertContent({
      signals: [anomalySignal({ slopePerDay: 3, readingType: "post_meal" })],
      patientName: "A",
      language: "en",
    });
    expect(postMeal.summary).toContain("post-meal");

    const unknown = buildAlertContent({
      signals: [anomalySignal({ slopePerDay: 3, readingType: "random" })],
      patientName: "A",
      language: "en",
    });
    expect(unknown.summary).toContain("glucose");
  });

  it("picks the worst (largest) slope across multiple anomaly signals", () => {
    const out = buildAlertContent({
      signals: [
        anomalySignal({ slopePerDay: 2, readingType: "fasting" }),
        anomalySignal({ slopePerDay: 8, readingType: "post_meal" }),
      ],
      patientName: "A",
      language: "en",
    });
    expect(out.explanation).toContain("8");
    expect(out.explanation).toContain("post-meal");
  });

  it("a signal without a slope leaves the worst-slope at 0", () => {
    const out = buildAlertContent({
      signals: [anomalySignal({})],
      patientName: "A",
      language: "en",
    });
    expect(out.explanation).toContain("0 mg/dL");
  });
});

describe("buildAlertContent — combined", () => {
  it("merges a med and a trend signal into one alert", () => {
    const out = buildAlertContent({
      signals: [
        medSignal({ missedCount: 3, windowDays: 6 }),
        anomalySignal({ slopePerDay: 5, readingType: "fasting" }),
      ],
      patientName: "Ramesh ji",
      language: "hi",
    });
    expect(out.title).toBe("Dhyaan dene ki zaroorat hai");
    expect(out.explanation).toContain("Ramesh ji");
    expect(out.explanation).toContain("3");
    expect(out.explanation).toContain("5");

    const en = buildAlertContent({
      signals: [
        medSignal({ missedCount: 3, windowDays: 6 }),
        anomalySignal({ slopePerDay: 5, readingType: "fasting" }),
      ],
      patientName: "Ramesh",
      language: "en",
    });
    expect(en.title).toBe("Needs attention");
  });
});

describe("buildAlertContent — empty signals (degenerate)", () => {
  it("produces generic trend copy without crashing", () => {
    const out = buildAlertContent({ signals: [], patientName: "A", language: "hi" });
    expect(out.title).toBe("Sugar badh raha hai");
  });
});

// ---------------------------------------------------------------------
// SAFETY property test — verbatim-content / PII leakage (phase3.md C.8).
// ---------------------------------------------------------------------

describe("buildAlertContent — PII / verbatim-content safety", () => {
  it("never echoes a raw evidence string value into the copy (1000 runs)", () => {
    const evidenceValue = fc.oneof(fc.uuid(), fc.integer(), fc.double(), fc.boolean());

    const signalArb = fc.record({
      // Explicit type argument — fast-check's constantFrom widens string
      // literals to `string` without it.
      source: fc.constantFrom<AlertContentSignal["source"]>("med_adherence", "data_anomaly"),
      rawEvidence: fc.dictionary(fc.string(), evidenceValue),
    });

    fc.assert(
      fc.property(
        fc.uuid(), // poison — a value placed ONLY inside rawEvidence
        fc.string(), // patientName
        fc.constantFrom<AlertLanguage>("hi", "en", "hi-en"),
        fc.array(signalArb, { minLength: 0, maxLength: 4 }),
        (poison, patientName, language, signals) => {
          // Inject the poison under several plausible string keys —
          // medicine name, a chat fragment, a free-text note, the
          // reading type — exactly the fields that must NOT surface.
          const poisoned: AlertContentSignal[] = signals.map((s) => ({
            source: s.source,
            signalType: poison,
            rawEvidence: {
              ...s.rawEvidence,
              medicineName: poison,
              readingType: poison,
              note: poison,
              chatFragment: poison,
            },
          }));
          const out = buildAlertContent({ signals: poisoned, patientName, language });
          const blob = [out.title, out.summary, out.explanation, out.suggestedAction].join("\n");
          // The poison is a uuid — it must never appear in the copy.
          return !blob.includes(poison);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("interpolates the patient name verbatim (the one allowed free-text value)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (name) => {
          const out = buildAlertContent({
            signals: [medSignal({ missedCount: 3, windowDays: 7 })],
            patientName: name,
            language: "hi",
          });
          return out.summary.includes(name);
        },
      ),
      { numRuns: 200 },
    );
  });
});
