import { describe, expect, it } from "vitest";
import type { ChatCondition, ChatLanguage } from "@swasth/shared-types";
import { coldStartResponse, type ColdStartInput } from "./cold-start.js";
import { MEDICATION_REDIRECT } from "../chat-template-responses/templates.js";

const CONDITIONS: readonly ChatCondition[] = ["diabetes", "bp", "multi"];
const LANGUAGES: readonly ChatLanguage[] = ["hi", "en", "hi-en"];

const baseInput = (overrides: Partial<ColdStartInput> = {}): ColdStartInput => ({
  userStageDays: 1,
  condition: "diabetes",
  language: "hi",
  intent: "reading_summary",
  ...overrides,
});

describe("coldStartResponse — stage gate", () => {
  it("returns null past day 14", () => {
    expect(coldStartResponse(baseInput({ userStageDays: 15 }))).toBeNull();
    expect(coldStartResponse(baseInput({ userStageDays: 30 }))).toBeNull();
    expect(coldStartResponse(baseInput({ userStageDays: 365 }))).toBeNull();
  });

  it("day 14 itself is still cold-start (inclusive upper bound)", () => {
    const r = coldStartResponse(baseInput({ userStageDays: 14 }));
    expect(r).not.toBeNull();
  });
});

describe("coldStartResponse — bucket boundaries", () => {
  it("day 1, 2, 3 map to the 'just started' bucket", () => {
    for (const day of [1, 2, 3]) {
      const r = coldStartResponse(baseInput({ userStageDays: day }));
      expect(r?.content).toMatch(/streak shuru|streak has started/i);
    }
  });

  it("day 4, 5, 6 map to the 'going strong' bucket", () => {
    for (const day of [4, 5, 6]) {
      const r = coldStartResponse(baseInput({ userStageDays: day }));
      expect(r?.content).toMatch(/2-3 din|two or three more days/i);
    }
  });

  it("day 7 maps to the milestone bucket", () => {
    const r = coldStartResponse(baseInput({ userStageDays: 7 }));
    expect(r?.content).toMatch(/1 hafta|one week complete/i);
  });

  it("days 8-14 map to the 'approaching full unlock' bucket", () => {
    for (const day of [8, 10, 14]) {
      const r = coldStartResponse(baseInput({ userStageDays: day }));
      expect(r?.content).toMatch(/day 14|full insights|unlock/i);
    }
  });
});

describe("coldStartResponse — every (bucket × condition × language) populated", () => {
  it("returns non-empty content for all combos in stage ≤ 14", () => {
    for (const day of [1, 5, 7, 12]) {
      for (const condition of CONDITIONS) {
        for (const language of LANGUAGES) {
          const r = coldStartResponse(
            baseInput({
              userStageDays: day,
              condition,
              language,
            }),
          );
          expect(r, `${day}:${condition}:${language}`).not.toBeNull();
          expect(r?.tier).toBe("template");
          expect(r?.content.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("coldStartResponse — data-independent intents defer to templates", () => {
  it("medication_question returns the doctor redirect (not a stage message)", () => {
    const r = coldStartResponse(baseInput({ intent: "medication_question" }));
    expect(r?.content).toBe(MEDICATION_REDIRECT);
  });

  it("data_explainer returns the standard template, not a stage message", () => {
    const r = coldStartResponse(baseInput({ intent: "data_explainer" }));
    // From templates.ts the diabetes/hi data_explainer template:
    expect(r?.content).toMatch(/fasting sugar/i);
  });

  it("lifestyle returns the standard template", () => {
    const r = coldStartResponse(baseInput({ intent: "lifestyle" }));
    expect(r?.content).toMatch(/walk|halka|reduce|exercise/i);
  });

  it("open_ended is NOT data-independent — cold-start still fires", () => {
    const r = coldStartResponse(baseInput({ intent: "open_ended", userStageDays: 1 }));
    // Should fall to the stage message, not null.
    expect(r).not.toBeNull();
    expect(r?.content).toMatch(/streak shuru|streak has started/i);
  });
});
