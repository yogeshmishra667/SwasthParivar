import type { ChatCondition, ChatIntent, ChatLanguage } from "@swasth/shared-types";

// Tier 1 deterministic responses (phase3.md A.2 #4). Pure lookup table
// keyed on (intent, condition, language). Returns null when no template
// matches → the chat service falls through to Tier 2 (cached) or Tier 3
// (sonnet) per the cost router.
//
// Two non-negotiables encoded here:
//
//  - `medication_question` ALWAYS returns the doctor-redirect template
//    regardless of language or condition. Claude must never answer
//    "should I take this drug?" — CLAUDE.md "AI Chat Safety" rule #1.
//    The exact replacement string mirrors the Post-Response Safety
//    Filter (chat-safety-filter/types.ts SAFETY_REPLACEMENT) so the
//    user experience is consistent whether the redirect happens
//    pre-routing (here) or post-response (filter).
//
//  - `open_ended` intent has NO template — the entry is undefined for
//    every (condition, language) combo. Forces fall-through to Tier 3
//    so the user gets a real, reasoned answer.
//
// Hindi-first copy follows the tone rules in CLAUDE.md "Feedback
// Engine — Noise & Tone": neutral language, no "kharab"/"worse", no
// jargon, no guilt.

export interface TemplateResponse {
  content: string;
  // Always "template" — surfaced so callers can pass the result
  // straight to the response envelope without re-tagging.
  tier: "template";
}

// Single source of truth for the medication redirect. Kept identical
// across languages because the redirect is a safety guarantee, not a
// translation choice.
export const MEDICATION_REDIRECT = "Yeh sawaal doctor se poochna best rahega." as const;

// Look up table: undefined entries indicate "no template, fall through".
// Sparse on purpose — the goal is high-confidence canned answers for
// the most common Tier 1 paths, not an exhaustive content management
// system.
const TEMPLATE_KEYS = (intent: ChatIntent, condition: ChatCondition, language: ChatLanguage) =>
  `${intent}:${condition}:${language}` as const;

const TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  // ── reading_summary ──────────────────────────────────────────────
  [TEMPLATE_KEYS("reading_summary", "diabetes", "hi")]:
    "Aapki recent readings dashboard pe dikh rahi hain. Pichhle 7 din ka weekly chart Sunday ko update hoga.",
  [TEMPLATE_KEYS("reading_summary", "diabetes", "en")]:
    "Your recent readings are on the dashboard. The 7-day weekly chart updates every Sunday.",
  [TEMPLATE_KEYS("reading_summary", "diabetes", "hi-en")]:
    "Aapki recent sugar readings dashboard pe hain. Weekly chart Sunday ko update hoga.",
  [TEMPLATE_KEYS("reading_summary", "bp", "hi")]:
    "Aapki BP readings dashboard pe dikh rahi hain. Weekly chart Sunday ko update hoga.",
  [TEMPLATE_KEYS("reading_summary", "bp", "en")]:
    "Your BP readings are on the dashboard. The weekly chart updates on Sunday.",
  [TEMPLATE_KEYS("reading_summary", "bp", "hi-en")]:
    "Aapki BP readings dashboard pe dikh rahi hain. Weekly chart Sunday ko aayegi.",
  [TEMPLATE_KEYS("reading_summary", "multi", "hi")]:
    "Sugar aur BP dono dashboard pe dikh rahe hain. Weekly chart Sunday ko aayega.",
  [TEMPLATE_KEYS("reading_summary", "multi", "en")]:
    "Both sugar and BP readings are visible on the dashboard. Weekly chart updates Sunday.",
  [TEMPLATE_KEYS("reading_summary", "multi", "hi-en")]:
    "Sugar aur BP dono dashboard pe hain. Weekly chart Sunday ko aayegi.",

  // ── data_explainer ──────────────────────────────────────────────
  [TEMPLATE_KEYS("data_explainer", "diabetes", "hi")]:
    "Fasting sugar subah uthne ke baad, khaane se pehle measure ki jaati hai. Post-meal sugar khaane ke 2 ghante baad ki reading hai.",
  [TEMPLATE_KEYS("data_explainer", "diabetes", "en")]:
    "Fasting sugar is measured in the morning before any food. Post-meal sugar is taken 2 hours after eating.",
  [TEMPLATE_KEYS("data_explainer", "diabetes", "hi-en")]:
    "Fasting sugar subah uthne ke baad measure hoti hai (no food). Post-meal khaane ke 2 hours baad.",
  [TEMPLATE_KEYS("data_explainer", "bp", "hi")]:
    "Systolic upar ka number hai (jab heart pump karta hai), diastolic neeche ka (jab heart relax hota hai).",
  [TEMPLATE_KEYS("data_explainer", "bp", "en")]:
    "Systolic is the upper number (heart pumping), diastolic is the lower (heart resting).",
  [TEMPLATE_KEYS("data_explainer", "bp", "hi-en")]:
    "Systolic upar wala number hai (heart pump), diastolic neeche (heart rest).",
  [TEMPLATE_KEYS("data_explainer", "multi", "hi")]:
    "Sugar aur BP dono ke explanations aapko Phase 2 ke insights mein milenge. Doctor se baat karein detail ke liye.",
  [TEMPLATE_KEYS("data_explainer", "multi", "en")]:
    "Explanations for both sugar and BP appear in your Phase 2 insights. Talk to your doctor for specifics.",
  [TEMPLATE_KEYS("data_explainer", "multi", "hi-en")]:
    "Sugar aur BP dono ka detail Phase 2 insights mein hai. Doctor se baat karein.",

  // ── lifestyle ───────────────────────────────────────────────────
  [TEMPLATE_KEYS("lifestyle", "diabetes", "hi")]:
    "Roz 20-30 minute walk, halka khaana, aur regular logging — sugar control ke teen sabse simple steps hain.",
  [TEMPLATE_KEYS("lifestyle", "diabetes", "en")]:
    "Daily 20–30 minute walk, light meals, and consistent logging are the three simplest steps for sugar control.",
  [TEMPLATE_KEYS("lifestyle", "diabetes", "hi-en")]:
    "20-30 minute daily walk, light meals, aur regular logging — sugar control ke 3 simple steps.",
  [TEMPLATE_KEYS("lifestyle", "bp", "hi")]:
    "Namak kam karein, daily walk karein, aur stress kam rakhein — BP control ke teen aasaan steps.",
  [TEMPLATE_KEYS("lifestyle", "bp", "en")]:
    "Reduce salt, walk daily, and keep stress low — three simple steps for BP control.",
  [TEMPLATE_KEYS("lifestyle", "bp", "hi-en")]:
    "Namak kam, daily walk, aur stress kam — BP control ke 3 simple steps.",
  [TEMPLATE_KEYS("lifestyle", "multi", "hi")]:
    "Walk, halka khaana, kam namak, aur regular logging — sugar aur BP dono ke liye yeh chaar steps important hain.",
  [TEMPLATE_KEYS("lifestyle", "multi", "en")]:
    "Walking, light meals, reduced salt, and consistent logging — these four steps help both sugar and BP.",
  [TEMPLATE_KEYS("lifestyle", "multi", "hi-en")]:
    "Walk, halka khaana, kam namak, regular logging — sugar aur BP dono ke liye yeh 4 steps important hain.",
});

export interface TemplateLookupInput {
  intent: ChatIntent;
  condition: ChatCondition;
  language: ChatLanguage;
}

export const lookupTemplate = (input: TemplateLookupInput): TemplateResponse | null => {
  // Safety pre-empts the lookup table. Same response regardless of
  // condition/language so the redirect is unambiguous.
  if (input.intent === "medication_question") {
    return { content: MEDICATION_REDIRECT, tier: "template" };
  }
  const key = TEMPLATE_KEYS(input.intent, input.condition, input.language);
  const content = TEMPLATES[key];
  return content === undefined ? null : { content, tier: "template" };
};
