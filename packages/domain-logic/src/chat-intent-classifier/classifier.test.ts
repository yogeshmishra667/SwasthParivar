import { describe, expect, it } from "vitest";
import { classifyIntent } from "./classifier.js";

const en = { language: "en" as const };
const hi = { language: "hi" as const };
const mixed = { language: "hi-en" as const };

describe("classifyIntent — medication_question priority", () => {
  it("English: explicit dose question", () => {
    expect(classifyIntent({ message: "Should I increase my metformin dose?", ...en })).toBe(
      "medication_question",
    );
  });

  it("English: side-effect question", () => {
    expect(classifyIntent({ message: "Is insulin safe with food?", ...en })).toBe(
      "medication_question",
    );
  });

  it("Hinglish: dawai timing question", () => {
    expect(classifyIntent({ message: "Dawai kab leni hai?", ...mixed })).toBe(
      "medication_question",
    );
  });

  it("Hinglish: kya/kab/kaise + medication", () => {
    expect(classifyIntent({ message: "Kya metformin abhi le sakte hain?", ...mixed })).toBe(
      "medication_question",
    );
  });

  it("Devanagari: दवाई कब लेनी है", () => {
    expect(classifyIntent({ message: "दवाई कब लेनी है", ...hi })).toBe("medication_question");
  });

  it("medication wins over a co-occurring lifestyle keyword", () => {
    expect(classifyIntent({ message: "Should I take metformin before walking?", ...en })).toBe(
      "medication_question",
    );
  });
});

describe("classifyIntent — data_explainer", () => {
  it("English: what is fasting", () => {
    expect(classifyIntent({ message: "What is fasting sugar?", ...en })).toBe("data_explainer");
  });

  it("English: HbA1c definition", () => {
    expect(classifyIntent({ message: "What does HbA1c mean?", ...en })).toBe("data_explainer");
  });

  it("Hinglish: fasting kya hai", () => {
    expect(classifyIntent({ message: "Fasting sugar kya hai?", ...mixed })).toBe("data_explainer");
  });

  it("Devanagari: बीपी क्या है", () => {
    expect(classifyIntent({ message: "बीपी क्या है?", ...hi })).toBe("data_explainer");
  });
});

describe("classifyIntent — reading_summary", () => {
  it("English: how am I doing", () => {
    expect(classifyIntent({ message: "How am I doing this week?", ...en })).toBe("reading_summary");
  });

  it("English: summarise weekly", () => {
    expect(classifyIntent({ message: "Summarise my sugar last 7 days", ...en })).toBe(
      "reading_summary",
    );
  });

  it("Hinglish: sugar kaisi chal rahi hai", () => {
    expect(classifyIntent({ message: "Meri sugar kaisi chal rahi hai?", ...mixed })).toBe(
      "reading_summary",
    );
  });

  it("Devanagari: मेरी शुगर कैसी है", () => {
    expect(classifyIntent({ message: "मेरी शुगर कैसी है?", ...hi })).toBe("reading_summary");
  });
});

describe("classifyIntent — lifestyle", () => {
  it("English: diet question", () => {
    expect(classifyIntent({ message: "Should I avoid rice for dinner?", ...en })).toBe("lifestyle");
  });

  it("English: exercise advice", () => {
    expect(classifyIntent({ message: "Is walking after meals good for sugar?", ...en })).toBe(
      "lifestyle",
    );
  });

  it("Hinglish: chalna ke baare mein", () => {
    expect(classifyIntent({ message: "Roz chalna kitna chahiye?", ...mixed })).toBe("lifestyle");
  });

  it("Devanagari: योग kitna karna", () => {
    expect(classifyIntent({ message: "योग कितनी देर करना चाहिए?", ...hi })).toBe("lifestyle");
  });
});

describe("classifyIntent — open_ended fallback", () => {
  it("Generic greeting falls back to open_ended", () => {
    expect(classifyIntent({ message: "Hello, namaste.", ...en })).toBe("open_ended");
  });

  it("Random thought falls back to open_ended", () => {
    expect(classifyIntent({ message: "Aaj mausam achcha hai.", ...mixed })).toBe("open_ended");
  });

  it("Empty string falls back to open_ended", () => {
    expect(classifyIntent({ message: "", ...en })).toBe("open_ended");
  });
});
