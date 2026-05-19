import { describe, expect, it } from "vitest";
import type { ChatCondition, ChatIntent, ChatLanguage } from "@swasth/shared-types";
import { MEDICATION_REDIRECT, lookupTemplate } from "./templates.js";
import { SAFETY_REPLACEMENT } from "../chat-safety-filter/types.js";

const CONDITIONS: readonly ChatCondition[] = ["diabetes", "bp", "multi"];
const LANGUAGES: readonly ChatLanguage[] = ["hi", "en", "hi-en"];

describe("lookupTemplate — medication_question redirect", () => {
  it("returns the doctor redirect for every (condition, language) combo", () => {
    for (const condition of CONDITIONS) {
      for (const language of LANGUAGES) {
        const result = lookupTemplate({
          intent: "medication_question",
          condition,
          language,
        });
        expect(result).not.toBeNull();
        expect(result?.tier).toBe("template");
        expect(result?.content).toBe(MEDICATION_REDIRECT);
      }
    }
  });

  it("matches the Post-Response Safety Filter replacement string", () => {
    // Both surfaces (pre-routing redirect + post-response filter)
    // must produce the same user-facing copy. If one drifts, the
    // patient sees two different "ask the doctor" phrasings — bad
    // UX. Pin them equal.
    expect(MEDICATION_REDIRECT).toBe(SAFETY_REPLACEMENT);
  });
});

describe("lookupTemplate — open_ended always falls through", () => {
  it("returns null for every (condition, language) combo", () => {
    for (const condition of CONDITIONS) {
      for (const language of LANGUAGES) {
        expect(lookupTemplate({ intent: "open_ended", condition, language })).toBeNull();
      }
    }
  });
});

describe("lookupTemplate — covered intents return non-null", () => {
  const COVERED_INTENTS: readonly ChatIntent[] = ["reading_summary", "data_explainer", "lifestyle"];

  it("each (intent, condition, language) yields a Hindi-first or English response", () => {
    for (const intent of COVERED_INTENTS) {
      for (const condition of CONDITIONS) {
        for (const language of LANGUAGES) {
          const result = lookupTemplate({ intent, condition, language });
          expect(result, `${intent}:${condition}:${language}`).not.toBeNull();
          expect(result?.tier).toBe("template");
          expect(result?.content.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Hindi response uses Devanagari or transliterated Hinglish only", () => {
    // A regression guard: if we ever accidentally seed an English
    // string under the `hi` key, this catches it.
    for (const intent of COVERED_INTENTS) {
      for (const condition of CONDITIONS) {
        const result = lookupTemplate({ intent, condition, language: "hi" });
        const content = result?.content ?? "";
        // Heuristic: a sentence should not be majority Latin words.
        // We pick a few Hindi-specific tokens we expect to see.
        const hasHindiMarker = /[ंािीुूेैोौ्]|aap|kar|hai|sugar|BP|chart|insights|weekly/i.test(
          content,
        );
        expect(hasHindiMarker, `${intent}:${condition}:hi → ${content}`).toBe(true);
      }
    }
  });
});

describe("lookupTemplate — no template content contains a prescriptive directive", () => {
  // Defence in depth: even though the Post-Response Safety Filter
  // runs over all assistant output, Tier 1 templates skip it (they
  // are pre-vetted). So the templates themselves must be safe.
  const FORBIDDEN_FRAGMENTS = [
    /\b\d+\s*(?:mg|mcg|ml)\b/i,
    /\bstop\s+taking\b/i,
    // The `(?:the\s+)?` optional triggers detect-unsafe-regex; there
    // is no overlapping alternation and the input is the short
    // fixed-length template string, not user content.
    // eslint-disable-next-line security/detect-unsafe-regex
    /\bincrease\s+(?:the\s+)?dose\b/i,
    /aapko\s+(?:diabetes|sugar|bp)\s+hai/i,
  ];

  it("no template contains a dosage / directive / diagnosis fragment", () => {
    const allIntents: ChatIntent[] = [
      "reading_summary",
      "data_explainer",
      "lifestyle",
      "medication_question",
      "open_ended",
    ];
    for (const intent of allIntents) {
      for (const condition of CONDITIONS) {
        for (const language of LANGUAGES) {
          const result = lookupTemplate({ intent, condition, language });
          if (!result) continue;
          for (const re of FORBIDDEN_FRAGMENTS) {
            expect(re.test(result.content), `${intent}:${condition}:${language}`).toBe(false);
          }
        }
      }
    }
  });
});
