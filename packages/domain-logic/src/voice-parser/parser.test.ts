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
    // CLAUDE.md required additions:
    ["paune do sau", 175],
    ["do sau", 200],
    ["teen sau", 300],
    ["ek sau das", 110],
    ["ek sau bees", 120],
    ["ek sau tees", 130],
    ["ek sau pachaas", 150],
    ["ek sau saath", 160],
    // Devanagari (CLAUDE.md: "Plus Devanagari variants"):
    ["सवा सौ", 125],
    ["डेढ़ सौ", 150],
  ])("'%s' → %i", (phrase, expected) => {
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
    if (r.kind === "rejected") expect(r.reason).toBe("negated_intent");
  });

  it("'aaj sugar 140 aayi' → accepted", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "aaj sugar 140 aayi" });
    expect(r.kind).toBe("ok");
  });

  it("'sugar 140 hai' → accepted", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 140 hai" });
    expect(r.kind).toBe("ok");
  });

  // Word-boundary safety: substring matchers would falsely reject these.
  it("'sugar 140 hai, thank you' → NOT past-tense (tha is inside 'thank')", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 140 hai thank you" });
    expect(r.kind).toBe("ok");
  });

  it("'Kalpana sugar 140 hai' → NOT past-tense (kal is inside 'Kalpana')", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "kalpana sugar 140 hai" });
    expect(r.kind).toBe("ok");
  });
});

describe("voice-parser uncertainty + confidence", () => {
  it.each(["shayad", "lagbhag", "approx", "hoga", "around", "kareeban"])(
    "'%s' triggers uncertaintyDetected + requiresStrongConfirmation",
    (word) => {
      const r = parseVoiceTranscript({ ...base, transcript: `${word} sugar 140 hai` });
      expect(r.kind).toBe("ok");
      if (r.kind === "ok") {
        expect(r.uncertaintyDetected).toBe(true);
        expect(r.requiresStrongConfirmation).toBe(true);
      }
    },
  );

  it("'lagta hai 140 hai' triggers uncertaintyDetected (multi-word)", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "lagta hai sugar 140 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.uncertaintyDetected).toBe(true);
  });

  it("confidence < 0.6 → requiresStrongConfirmation", () => {
    const r = parseVoiceTranscript({
      ...base,
      transcript: "sugar 140 hai",
      confidence: 0.4,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresStrongConfirmation).toBe(true);
  });

  it("confidence ≥ 0.6 + no uncertainty word → no strong confirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 140 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresStrongConfirmation).toBe(false);
  });
});

describe("voice-parser type inference", () => {
  it("6:30AM (hour=6) → fasting confident", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 90 hai",
      confidence: 0.9,
      capturedAtHourLocal: 6,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.readingType).toBe("fasting");
      expect(r.requiresTypeConfirmation).toBe(false);
    }
  });

  it("1:30PM (hour=13) → post_meal confident", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 160 hai",
      confidence: 0.9,
      capturedAtHourLocal: 13,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.readingType).toBe("post_meal");
      expect(r.requiresTypeConfirmation).toBe(false);
    }
  });

  it("8PM (hour=20) → post_meal confident", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 160 hai",
      confidence: 0.9,
      capturedAtHourLocal: 20,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.readingType).toBe("post_meal");
      expect(r.requiresTypeConfirmation).toBe(false);
    }
  });

  it("3PM (hour=15) → uncertain, must confirm type", () => {
    const r = parseVoiceTranscript({
      transcript: "sugar 140 hai",
      confidence: 0.9,
      capturedAtHourLocal: 15,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresTypeConfirmation).toBe(true);
  });

  it("'subah' keyword at noon → fasting (keyword wins over clock)", () => {
    const r = parseVoiceTranscript({
      transcript: "subah sugar 95 hai",
      confidence: 0.9,
      capturedAtHourLocal: 12,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.readingType).toBe("fasting");
  });

  it("'khane ke baad' keyword at 6AM → post_meal (keyword wins over clock)", () => {
    const r = parseVoiceTranscript({
      transcript: "khane ke baad sugar 180 hai",
      confidence: 0.9,
      capturedAtHourLocal: 6,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.readingType).toBe("post_meal");
  });
});

describe("voice-parser range validation", () => {
  it("value 15 → rejected (below valid range)", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 15 hai" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("out_of_range");
  });

  it("value 50 (critical low) → ok with requiresDoubleConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 50 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBe(50);
      expect(r.requiresDoubleConfirmation).toBe(true);
    }
  });

  it("value 350 (critical high) → ok with requiresDoubleConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 350 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBe(350);
      expect(r.requiresDoubleConfirmation).toBe(true);
    }
  });

  it("value 65 (boundary, not critical) → ok without requiresDoubleConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 65 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresDoubleConfirmation).toBe(false);
  });

  it("value 315 (boundary, not critical) → ok without requiresDoubleConfirmation", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "sugar 315 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresDoubleConfirmation).toBe(false);
  });
});

describe("voice-parser intent gating", () => {
  // CLAUDE.md: "TV/radio numbers without intent → ignore."
  it("'the temperature is 140 today' → rejected no_intent (background noise)", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "the temperature is 140 today" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_intent");
  });

  it("bare '140' with no intent → rejected no_intent", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "140" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_intent");
  });

  it("'140 hai' (intent present) → ok", () => {
    const r = parseVoiceTranscript({ ...base, transcript: "140 hai" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(140);
  });
});

describe("voice-parser multiple-number ranking", () => {
  // CLAUDE.md: "Returns ranked list with recommended=true for closest
  // to intent keyword."
  it("two numbers, intent near the second → second is recommended", () => {
    const r = parseVoiceTranscript({
      ...base,
      transcript: "address 220, sugar 145 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      const recommended = r.candidates.find((c) => c.recommended);
      expect(recommended?.value).toBe(145);
      expect(r.value).toBe(145);
    }
  });

  it("returns all candidates ranked", () => {
    const r = parseVoiceTranscript({
      ...base,
      transcript: "address 220, sugar 145 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.candidates.length).toBe(2);
      expect(r.candidates.some((c) => c.value === 220)).toBe(true);
      expect(r.candidates.some((c) => c.value === 145)).toBe(true);
    }
  });
});
