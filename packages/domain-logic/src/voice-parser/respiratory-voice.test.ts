import { describe, expect, it } from "vitest";
import { RESPIRATORY_VOICE_FIXTURES } from "@swasth/test-factories";
import { parseRespiratoryVoiceTranscript } from "./respiratory-voice.js";

const base = { confidence: 0.9 } as const;

describe("parseRespiratoryVoiceTranscript — happy path", () => {
  it.each([
    ["peak flow 450 hai", 450],
    ["peak flow is 380", 380],
    ["saans 480 hai aaj", 480],
    ["breath rate 200 hai", 200],
    ["asthma reading 450 hai", 450],
    ["inhaler ke baad peak flow 420 hai", 420],
  ])("'%s' → %i", (transcript, expected) => {
    const r = parseRespiratoryVoiceTranscript({ ...base, transcript });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBe(expected);
  });

  it("Hindi colloquial 'do sau' resolves to 200", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "peak flow do sau hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBe(200);
      expect(r.colloquialMatch).toBe(true);
    }
  });
});

describe("parseRespiratoryVoiceTranscript — rejections", () => {
  it("rejects no-intent transcript", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "TV pe 400 bola",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_intent");
  });

  it("rejects past tense without present indicator", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "kal peak flow 400 tha",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("past_tense_only");
  });

  it("rejects negated intent", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "aaj peak flow check nahi ki",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("negated_intent");
  });

  it("rejects below PEAK_FLOW_VALID_MIN=50", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "peak flow 30 hai",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("out_of_range");
  });

  it("rejects above PEAK_FLOW_VALID_MAX=800", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "peak flow 850 hai",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("out_of_range");
  });

  it("rejects empty transcript", () => {
    const r = parseRespiratoryVoiceTranscript({ ...base, transcript: "" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_number");
  });

  it("rejects transcript with intent but no number", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "peak flow check karein",
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe("no_number");
  });
});

describe("parseRespiratoryVoiceTranscript — confirmation flags", () => {
  it("low speech confidence requires strong confirmation", () => {
    const r = parseRespiratoryVoiceTranscript({
      transcript: "peak flow 480 hai",
      confidence: 0.4,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.requiresStrongConfirmation).toBe(true);
  });

  it("uncertainty word 'lagbhag' flags uncertaintyDetected", () => {
    const r = parseRespiratoryVoiceTranscript({
      ...base,
      transcript: "peak flow lagbhag 450 hai",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.uncertaintyDetected).toBe(true);
  });
});

describe("parseRespiratoryVoiceTranscript — fixture compliance", () => {
  it.each(RESPIRATORY_VOICE_FIXTURES.map((f) => [f.label, f] as const))(
    "fixture '%s' matches its expected verdict",
    (_label, fixture) => {
      const r = parseRespiratoryVoiceTranscript({
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
