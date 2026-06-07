export const HINDI_COLLOQUIAL: ReadonlyMap<string, number> = new Map([
  ["sava sau", 125],
  ["savaa sau", 125],
  ["सवा सौ", 125],
  ["dedh sau", 150],
  ["derh sau", 150],
  ["डेढ़ सौ", 150],
  ["paune do sau", 175],
  ["do sau", 200],
  ["sava do sau", 225],
  ["savaa do sau", 225],
  ["dhai sau", 250],
  ["paune teen sau", 275],
  ["teen sau", 300],
  ["ek sau das", 110],
  ["ek sau bees", 120],
  ["ek sau tees", 130],
  ["ek sau chaalees", 140],
  ["ek sau chalis", 140],
  ["ek sau pachaas", 150],
  ["ek sau pachas", 150],
  ["ek sau saath", 160],
  ["ek sau sath", 160],
]);

export const PAST_INDICATORS: readonly string[] = ["thi", "tha", "kal", "pichle", "last"];

export const PRESENT_INDICATORS: readonly string[] = ["hai", "aayi", "abhi", "aaj", "check ki"];

export const NEGATED_INTENT: readonly string[] = ["nahi ki", "nahi hua", "nahi li", "check nahi"];

export const UNCERTAINTY_WORDS: readonly string[] = [
  "shayad",
  "lagbhag",
  "approx",
  "hoga",
  "lagta hai",
  "around",
  "kareeban",
];

export const INTENT_KEYWORDS: readonly string[] = [
  "sugar",
  "aayi",
  "hai",
  "meri",
  "aaj",
  "glucose",
];

export const FASTING_KEYWORDS: readonly string[] = ["subah", "morning", "fasting", "khali pet"];

export const POST_MEAL_KEYWORDS: readonly string[] = [
  "khana khane ke baad",
  "khane ke baad",
  "post meal",
  "post-meal",
  "after meal",
];

// ─────────────────────────────────────────────────────────────
// Phase 4 Feature E — cardiac + respiratory voice intent keywords.
// Mirrors the glucose `INTENT_KEYWORDS` shape: presence of any of
// these grounds a number-in-the-transcript as the actual reading;
// absence routes through "no_intent" rejection so a TV/radio number
// without medical context is ignored (CLAUDE.md "Background Noise").
// ─────────────────────────────────────────────────────────────

export const CARDIAC_INTENT_KEYWORDS: readonly string[] = [
  "dhadkan",
  "dil ki dhadkan",
  "dil",
  "pulse",
  "heart rate",
  "heartbeat",
  "heart",
];

export const RESPIRATORY_INTENT_KEYWORDS: readonly string[] = [
  "peak flow",
  "saans",
  "saans phoolti",
  "breath",
  "breathing",
  "asthma",
  "inhaler",
];
