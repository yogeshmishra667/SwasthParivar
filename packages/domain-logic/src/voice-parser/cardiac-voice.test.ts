import { describe, expect, it } from "vitest";
import { CARDIAC_VOICE_FIXTURES } from "@swasth/test-factories";
import { parseCardiacVoiceTranscript } from "./cardiac-voice.js";

const base = { confidence: 0.9 } as const;

describe("parseCardiacVoiceTranscript — happy path", () => {
  it.each([
    ["dhadkan 85 hai", 85],
    ["dil ki dhadkan 72 hai", 72],
    ["pulse 90 hai aaj", 90],
    ["heart rate is 100", 100],
    ["heartbeat 80 abhi", 80],
  ])("'%s' → %i", (transcript, expected) => {
    const r = parseCardiacVoiceTranscript({ ...base, transcript });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(expected);
  });

  it("a past-tense marker inside another word is not past tense ('tha' in 'thakaan')", () => {
    // "thakaan" (tiredness) starts with the past indicator "tha"; only a
    // standalone "tha" means past tense, so this present reading stands.
    const r = parseCardiacVoiceTranscript({ ...base, transcript: "thakaan hai, dhadkan 95" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(95);
  });

  it("Hindi colloquial 'ek sau bees' resolves to 120", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "dhadkan ek sau bees hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBe(120);
      expect(r.colloquialMatch).toBe(true);
    }
  });
});

describe("parseCardiacVoiceTranscript — rejections", () => {
  it("rejects no-intent transcript (TV background number)", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "TV pe khabar mein 85 bola",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_intent");
  });

  it("rejects past tense without present indicator", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "kal dhadkan 90 thi",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("past_tense_only");
  });

  it("rejects negated intent", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "aaj dhadkan check nahi ki",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("negated_intent");
  });

  it("rejects below HR_VALID_MIN=30", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "dhadkan 25 hai",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("out_of_range");
  });

  it("rejects above HR_VALID_MAX=250", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "dhadkan 280 hai",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("out_of_range");
  });

  it("rejects empty transcript", () => {
    const r = parseCardiacVoiceTranscript({ ...base, transcript: "   " });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_number");
  });

  it("rejects transcript with intent but no number", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "dhadkan check kar lo",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_number");
  });
});

describe("parseCardiacVoiceTranscript — confirmation flags", () => {
  it("low speech confidence requires strong confirmation", () => {
    const r = parseCardiacVoiceTranscript({
      transcript: "dhadkan 85 hai",
      confidence: 0.4,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresStrongConfirmation).toBe(true);
  });

  it("Hindi uncertainty word flags uncertaintyDetected", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "shayad dhadkan 90 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.uncertaintyDetected).toBe(true);
  });

  it("normal high-confidence transcript does NOT require strong confirmation", () => {
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "dhadkan 78 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.requiresStrongConfirmation).toBe(false);
      expect(r.uncertaintyDetected).toBe(false);
    }
  });
});

describe("parseCardiacVoiceTranscript — intent ranking", () => {
  it("number after intent keyword wins over number before", () => {
    // Address 220 appears before the dhadkan intent; the 85 after
    // wins because intent-keyword distance scoring penalises the
    // before-intent value.
    const r = parseCardiacVoiceTranscript({
      ...base,
      transcript: "address 220, dhadkan 85 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(85);
  });
});

describe("parseCardiacVoiceTranscript — fixture compliance", () => {
  it.each(CARDIAC_VOICE_FIXTURES.map((f) => [f.label, f] as const))(
    "fixture '%s' matches its expected verdict",
    (_label, fixture) => {
      const r = parseCardiacVoiceTranscript({
        transcript: fixture.transcript,
        confidence: fixture.confidence,
      });
      if (fixture.expectedAccept) {
        expect(r.kind).toBe("ok");
        if (r.kind === "ok" && fixture.expectedValue !== null) {
          expect(r.value).toBe(fixture.expectedValue);
        }
      } else {
        expect(r.kind).toBe("rejected");
      }
    },
  );
});
