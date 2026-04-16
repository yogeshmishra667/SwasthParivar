import { describe, expect, it } from "vitest";
import { parseVoiceTranscript } from "./parser.js";

const base = { confidence: 0.9, capturedAtHourLocal: 13 };

describe("voice-parser colloquial Hindi", () => {
  it.each([
    ["sava sau", 125],
    ["dedh sau", 150],
    ["dhai sau", 250],
    ["sava do sau", 225],
    ["paune teen sau", 275],
    ["ek sau chaalees", 140],
  ])("%s → %i", (phrase, expected) => {
    const r = parseVoiceTranscript({ ...base, transcript: `sugar ${phrase} hai` });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBe(expected);
      expect(r.colloquialMatch).toBe(true);
    }
  });

  it("digit form 140 also parses", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 140 aayi aaj" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(140);
  });
});

describe("voice-parser past-tense rejection", () => {
  it("'kal sugar 140 thi' → rejected past_tense_only", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "kal sugar 140 thi" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("past_tense_only");
  });

  it("'kal 140 thi aaj check nahi ki' → rejected (negated_intent wins)", () => {
    const r = parseVoiceTranscript({
      ...base,
      transcript: "kal 140 thi aaj check nahi ki",
    });
    expect(r.kind).toBe("rejected");
  });

  it("'aaj sugar 140 aayi' → accepted", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "aaj sugar 140 aayi" });
    expect(r.kind).toBe("ok");
  });

  it("'sugar 140 hai' → accepted", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 140 hai" });
    expect(r.kind).toBe("ok");
  });
});

describe("voice-parser uncertainty + confidence", () => {
  it("'shayad 140 hai' → requiresStrongConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "shayad sugar 140 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.uncertaintyDetected).toBe(true);
      expect(r.requiresStrongConfirmation).toBe(true);
    }
  });

  it("confidence < 0.6 → requiresStrongConfirmation", () => {
    const r = parseVoiceTranscript({
      ...base,
      transcript: "sugar 140 hai",
      confidence: 0.4,
    });
    if (r.kind === "ok") expect(r.requiresStrongConfirmation).toBe(true);
  });
});

describe("voice-parser type inference", () => {
  it("6:30AM (hour=6) → fasting", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 90 hai",
      confidence: 0.9,
      capturedAtHourLocal: 6,
    });
    if (r.kind === "ok") {
      expect(r.readingType).toBe("fasting");
      expect(r.requiresTypeConfirmation).toBe(false);
    }
  });

  it("3PM (hour=15) → uncertain", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 140 hai",
      confidence: 0.9,
      capturedAtHourLocal: 15,
    });
    if (r.kind === "ok") expect(r.requiresTypeConfirmation).toBe(true);
  });

  it("'subah' keyword at noon → fasting (keyword wins)", () => {
    const r = parseVoiceTranscript({
      transcript: "subah sugar 95 hai",
      confidence: 0.9,
      capturedAtHourLocal: 12,
    });
    if (r.kind === "ok") expect(r.readingType).toBe("fasting");
  });
});

describe("voice-parser range validation", () => {
  it("value 15 → out_of_range", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 15 hai" });
    expect(r.kind).toBe("rejected");
  });

  it("value 50 (critical) → ok with requiresDoubleConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 50 hai" });
    if (r.kind === "ok") expect(r.requiresDoubleConfirmation).toBe(true);
  });
});
