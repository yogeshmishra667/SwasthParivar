import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectDiagnosisClaim,
  detectDoseChange,
  detectDosageNumber,
  detectEmergencyAdvice,
  detectStartStopDirective,
  detectVerbatimPii,
  filterChatResponse,
} from "./filter.js";
import { SAFETY_REPLACEMENT, type SafetyFilterInput } from "./types.js";

const run = (content: string, language: SafetyFilterInput["language"] = "hi-en") =>
  filterChatResponse({ content, language });

describe("filterChatResponse — safe pass-through", () => {
  it("empty string is safe", () => {
    const r = run("");
    expect(r.safe).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.redactedContent).toBe("");
    expect(r.originalContent).toBe("");
  });

  it("generic encouragement passes (kam karein without med context)", () => {
    const r = run("Stress kam karein. Walk karna shuru karein. Khaane mein meetha kam.");
    expect(r.safe).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("educational explanation passes", () => {
    const r = run(
      "Diabetes ek aisi condition hai jisme blood sugar zyada ho jata hai. Doctor se regular check karaayein.",
    );
    expect(r.safe).toBe(true);
  });

  it("normal Hindi feedback passes", () => {
    const r = run("Aapki reading thodi zyada hai aaj. Paani peeyein aur thoda walk karein.");
    expect(r.safe).toBe(true);
  });

  it("English summary without prescriptive language passes", () => {
    const r = run(
      "Your fasting numbers have been steady this week. Keep logging consistently and your weekly chart will update on Sunday.",
    );
    expect(r.safe).toBe(true);
  });

  it("`continue exercising` does not flag start_stop", () => {
    const r = run("Please continue exercising daily — it is very helpful for sugar control.");
    expect(r.safe).toBe(true);
  });

  it("`stop worrying` does not flag start_stop", () => {
    const r = run("Stop worrying about one high reading. Look at the weekly trend instead.");
    expect(r.safe).toBe(true);
  });

  it("`chinta band karein` does not flag start_stop", () => {
    const r = run("Itni chinta band karein. Doctor se baat karein agar zyada lage.");
    expect(r.safe).toBe(true);
  });

  it("number with units other than medicine does not flag dosage", () => {
    const r = run("Aap roz 5000 steps walk karein. 30 minute exercise kaafi hai.");
    expect(r.safe).toBe(true);
  });
});

describe("dosage_number detector", () => {
  it("English mg form", () => {
    expect(detectDosageNumber("Take 500 mg of metformin daily")).toBe(true);
  });

  it("English `2 tablets`", () => {
    expect(detectDosageNumber("You should have 2 tablets after lunch")).toBe(true);
  });

  it("compact form `10mcg`", () => {
    expect(detectDosageNumber("Increase to 10mcg")).toBe(true);
  });

  it("Hinglish `do goli`", () => {
    expect(detectDosageNumber("Do goli khaa lo subah")).toBe(true);
  });

  it("Hinglish `aadhi goli`", () => {
    expect(detectDosageNumber("Aadhi goli kafi hai")).toBe(true);
  });

  it("Devanagari `500 मिग्रा`", () => {
    expect(detectDosageNumber("रोज़ 500 मिग्रा दवा लें")).toBe(true);
  });

  it("Devanagari `२ गोली`", () => {
    expect(detectDosageNumber("रोज़ २ गोली खाएं")).toBe(true);
  });

  it("clean text is not flagged", () => {
    expect(detectDosageNumber("Sugar 140 thi aaj")).toBe(false);
  });
});

describe("start_stop_directive detector", () => {
  it("English `stop taking medication`", () => {
    expect(detectStartStopDirective("You should stop taking this medication")).toBe(true);
  });

  it("English `start taking metformin`", () => {
    expect(detectStartStopDirective("Please start taking metformin from tomorrow")).toBe(true);
  });

  it("English `discontinue the drug`", () => {
    expect(detectStartStopDirective("Discontinue the drug if you feel sick")).toBe(true);
  });

  it("Hinglish `dawai band karein`", () => {
    expect(detectStartStopDirective("Aap dawai band kar dein turant")).toBe(true);
  });

  it("Hinglish `dawai shuru kar`", () => {
    expect(detectStartStopDirective("Kal se nayi dawai shuru karein")).toBe(true);
  });

  it("Devanagari `दवाई बंद`", () => {
    expect(detectStartStopDirective("दवाई बंद करें")).toBe(true);
  });

  it("`stop worrying` (no med noun) does not flag", () => {
    expect(detectStartStopDirective("Stop worrying about it")).toBe(false);
  });

  it("`continue exercising` (no med noun) does not flag", () => {
    expect(detectStartStopDirective("Continue exercising daily")).toBe(false);
  });
});

describe("dose_change detector", () => {
  it("English `increase the dose`", () => {
    expect(detectDoseChange("You should increase the dose to 1000mg")).toBe(true);
  });

  it("English `reduce dosage`", () => {
    expect(detectDoseChange("Reduce dosage by half if you feel dizzy")).toBe(true);
  });

  it("English `more dose`", () => {
    expect(detectDoseChange("Need more dose for the same effect with this medicine")).toBe(true);
  });

  it("English `take 1000mg instead of 500mg`", () => {
    expect(detectDoseChange("Take 1000mg instead of 500mg from now on with dose")).toBe(true);
  });

  it("Hinglish `dose badha dein`", () => {
    expect(detectDoseChange("Aap dose badha dein 1000 tak")).toBe(true);
  });

  it("Hinglish `kam karo dose`", () => {
    expect(detectDoseChange("Aaj se kam karo dose half")).toBe(true);
  });

  it("Devanagari `खुराक बढ़ा`", () => {
    expect(detectDoseChange("खुराक बढ़ा दें")).toBe(true);
  });

  it("`stress kam karein` (no dose noun) does not flag", () => {
    expect(detectDoseChange("Stress kam karein")).toBe(false);
  });

  it("`reduce salt` (no dose noun) does not flag", () => {
    expect(detectDoseChange("Reduce salt intake")).toBe(false);
  });
});

describe("diagnosis_claim detector", () => {
  it("English `you have diabetes`", () => {
    expect(detectDiagnosisClaim("Based on these numbers you have diabetes")).toBe(true);
  });

  it("English `you are diabetic`", () => {
    expect(detectDiagnosisClaim("You are diabetic — start lifestyle changes")).toBe(true);
  });

  it("English `diagnosed with hypertension`", () => {
    expect(detectDiagnosisClaim("You are diagnosed with hypertension")).toBe(true);
  });

  it("Hinglish `aapko sugar ki bimari hai`", () => {
    expect(detectDiagnosisClaim("Aapko sugar ki bimari hai")).toBe(true);
  });

  it("Hinglish `aap diabetic hain`", () => {
    expect(detectDiagnosisClaim("Aap diabetic hain")).toBe(true);
  });

  it("Devanagari `आपको डायबिटीज़ है`", () => {
    expect(detectDiagnosisClaim("आपको डायबिटीज़ है")).toBe(true);
  });

  it("educational sentence about diabetes does not flag", () => {
    expect(detectDiagnosisClaim("Diabetes ek metabolic condition hai")).toBe(false);
  });
});

describe("emergency_advice detector", () => {
  it("English `drink sugar water now`", () => {
    expect(detectEmergencyAdvice("Drink sugar water now if you feel weak")).toBe(true);
  });

  it("English `call ambulance now`", () => {
    expect(detectEmergencyAdvice("Call ambulance now")).toBe(true);
  });

  it("Hinglish `abhi mithai khao`", () => {
    expect(detectEmergencyAdvice("Abhi mithai khao")).toBe(true);
  });

  it("Devanagari `तुरंत जूस पीयें`", () => {
    expect(detectEmergencyAdvice("तुरंत जूस पीयें")).toBe(true);
  });

  it("general lifestyle advice does not flag", () => {
    expect(detectEmergencyAdvice("Drink water through the day")).toBe(false);
  });
});

describe("verbatim_pii detector", () => {
  it("flags 10-digit Indian mobile", () => {
    expect(detectVerbatimPii("Call me at 9876543210")).toBe(true);
  });

  it("flags Aadhaar with spaces", () => {
    expect(detectVerbatimPii("Aadhaar: 1234 5678 9012")).toBe(true);
  });

  it("flags Aadhaar without spaces", () => {
    expect(detectVerbatimPii("UID 123456789012")).toBe(true);
  });

  it("flags email address", () => {
    expect(detectVerbatimPii("Write to doctor@example.com")).toBe(true);
  });

  it("does not flag short numeric like reading 145", () => {
    expect(detectVerbatimPii("Your reading was 145")).toBe(false);
  });

  it("does not flag mobile starting with 5 (invalid Indian prefix)", () => {
    expect(detectVerbatimPii("Number 5123456789")).toBe(false);
  });
});

describe("filterChatResponse — orchestrator behaviour", () => {
  it("unsafe content is replaced with SAFETY_REPLACEMENT", () => {
    const r = run("Increase the dose to 1000mg of metformin");
    expect(r.safe).toBe(false);
    expect(r.redactedContent).toBe(SAFETY_REPLACEMENT);
  });

  it("unsafe content preserves originalContent for audit", () => {
    const r = run("Stop taking metformin");
    expect(r.originalContent).toBe("Stop taking metformin");
    expect(r.redactedContent).toBe(SAFETY_REPLACEMENT);
  });

  it("multiple violations are all collected", () => {
    const r = run("Stop taking metformin and increase the dose of insulin to 200mg");
    expect(r.violations).toEqual(
      expect.arrayContaining(["dosage_number", "start_stop_directive", "dose_change"]),
    );
  });

  it("language input is respected (does not change result)", () => {
    const a = run("Sab theek hai aaj.", "hi");
    const b = run("Sab theek hai aaj.", "en");
    const c = run("Sab theek hai aaj.", "hi-en");
    expect(a.safe && b.safe && c.safe).toBe(true);
  });

  it("safe response leaves redactedContent identical to input", () => {
    const text = "Aapki streak 7 din ki ho gayi. Achchi baat hai.";
    const r = run(text);
    expect(r.redactedContent).toBe(text);
  });
});

describe("property — adversarial inputs never bypass dosage_number", () => {
  it("digits adjacent to medicine units are always flagged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.constantFrom("mg", "mcg", "ml", "tablets", "tabs", "pills", "capsules", "iu"),
        fc.string({ maxLength: 30 }),
        fc.string({ maxLength: 30 }),
        (num, unit, prefix, suffix) => {
          const text = `${prefix} ${num} ${unit} ${suffix}`;
          return detectDosageNumber(text);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Hinglish count + medicine noun is always flagged", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ek", "do", "teen", "chaar", "paanch", "aadhi"),
        fc.constantFrom("goli", "tablet", "capsule", "khurak"),
        fc.string({ maxLength: 30 }),
        (count, noun, suffix) => {
          const text = `${count} ${noun} ${suffix}`;
          return detectDosageNumber(text);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("filter is idempotent — feeding output back yields same safe result", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const first = filterChatResponse({ content: raw, language: "hi-en" });
        const second = filterChatResponse({
          content: first.redactedContent,
          language: "hi-en",
        });
        // Replacement string is itself safe; any safe input stays safe.
        return second.safe === true;
      }),
      { numRuns: 100 },
    );
  });
});
