import type { ChatIntent, ChatLanguage } from "@swasth/shared-types";

// Lightweight keyword-based intent classifier (Phase 3 Feature A —
// supports A.4 step 6 by giving chat-cost-router an intent input).
//
// Pure function, IO-free, deterministic. Word-boundary matching where
// possible; Devanagari is matched substring-style because `\b` doesn't
// span Unicode scripts in JavaScript regex.
//
// Design rules:
//   1. `medication_question` wins over everything else. A patient
//      message that says "metformin" + "increase" must route to
//      template (safety redirect) even if it also mentions sugar
//      values. The Post-Response Safety Filter is a second line;
//      catching it here saves a Claude call.
//   2. `data_explainer` catches definitional questions ("what is
//      fasting", "fasting kya hai") regardless of recent readings —
//      Tier 1 templates serve these well.
//   3. `reading_summary` triggers on summary verbs ("summarise",
//      "how am I doing", "kaisi hai") — Tier 3 sonnet handles these
//      with reading context.
//   4. `lifestyle` triggers on diet / exercise / sleep keywords —
//      Tier 1 templates serve these.
//   5. Everything else → `open_ended` (Tier 3 default).
//
// Coverage target: 100% (phase3.md A.9 raise the bar on pure modules).
// Verified via vitest.config.ts per-file ratchet.
//
// `language` is accepted for future per-language tuning. The current
// implementation walks every keyword bank regardless because chat
// content is commonly code-mixed and a hard language gate would miss
// transliterated Hinglish.

/* eslint-disable security/detect-unsafe-regex */

interface IntentBank {
  readonly intent: ChatIntent;
  readonly patterns: readonly RegExp[];
}

// Priority order — first match wins. The Bank list is the source of
// truth; reordering it changes routing.
const BANKS: readonly IntentBank[] = [
  // ── medication_question ─────────────────────────────────────
  // Anchored on med nouns + an intent verb so generic mentions of
  // "Metformin works by..." don't trigger.
  {
    intent: "medication_question",
    patterns: [
      // English: explicit ask about a medication
      /\b(?:should|can|may|how|when|do)\b.{0,40}\b(?:medicine|medication|drug|tablet|pill|capsule|metformin|insulin|aspirin|statin|dose|dosage)\b/i,
      /\b(?:medicine|medication|drug|tablet|pill|capsule|metformin|insulin|aspirin|statin|dose|dosage)\b.{0,30}\b(?:safe|side\s+effect|take|skip|miss|stop|start)\b/i,
      // Hinglish: "dawai", "khurak", "matra" with question intent
      /\b(?:dawai|dawayi|dava|davai|goli|insulin|metformin|khurak|matra|dose)\b.{0,40}\b(?:kya|kab|kaise|le|leni|bandh|band|shuru|chod|miss)\b/i,
      /\b(?:kya|kab|kaise)\s+.{0,20}\b(?:dawai|dawayi|dava|davai|goli|insulin|metformin|dose|khurak)\b/i,
      // Devanagari
      /(?:दवा|दवाई|गोली|खुराक|डोज़|डोज|मात्रा).{0,30}(?:क्या|कब|कैसे|लेनी|छोड़|बंद|शुरू)/u,
    ],
  },
  // ── data_explainer ──────────────────────────────────────────
  // Definitional questions about the data itself.
  {
    intent: "data_explainer",
    patterns: [
      /\bwhat\s+(?:is|are|does|means?)\b.{0,30}\b(?:fasting|post[-\s]?meal|hba1c|systolic|diastolic|bp|blood\s+pressure)\b/i,
      /\b(?:fasting|post[-\s]?meal|hba1c|systolic|diastolic|bp|blood\s+pressure)\b.{0,15}\bmeans?\b/i,
      /\b(?:fasting|post[-\s]?meal|hba1c|systolic|diastolic|bp)\b(?:\s+\w+){0,2}\s+kya\s+ha[iy]\b/i,
      /\bkya\s+(?:hota|hoti)\s+ha[iy]\b.{0,30}\b(?:fasting|post[-\s]?meal|hba1c|sugar|bp)\b/i,
      /(?:फास्टिंग|पोस्ट[-\s]?मील|एचबीए1सी|सिस्टोलिक|डायस्टोलिक|बीपी).{0,15}क्या\s+है/u,
    ],
  },
  // ── reading_summary ─────────────────────────────────────────
  // "How am I doing", "Kaisi chal rahi hai", "summarise this week".
  {
    intent: "reading_summary",
    patterns: [
      /\b(?:summari[sz]e|how\s+am\s+i|how\s+have\s+i\s+been|what(?:'s|\s+is)\s+my\s+(?:trend|average|level))\b/i,
      /\b(?:weekly|this\s+week|last\s+(?:week|month)|past\s+\d+\s+days?)\b.{0,30}\b(?:sugar|bp|reading|level|trend|summary)\b/i,
      /\b(?:meri|aapki)?\s*(?:sugar|bp|reading|chart)\b.{0,30}\b(?:kaisi|kaise|kaisa)\b/i,
      /\bkaisi?\s+(?:chal\s+rahi|hai)\b/i,
      /(?:मेरी|आपकी)?\s*(?:शुगर|बीपी|रीडिंग).{0,15}(?:कैसी|कैसा|कैसे)/u,
    ],
  },
  // ── lifestyle ───────────────────────────────────────────────
  // Diet, exercise, sleep, stress.
  {
    intent: "lifestyle",
    patterns: [
      /\b(?:diet|exercise|walk|walking|yoga|sleep|stress|food|meal|breakfast|lunch|dinner)\b/i,
      /\b(?:khaana|khana|chalna|paidal|neend|tanav|stress|naashta|bhojan)\b/i,
      /(?:खाना|व्यायाम|योग|नींद|तनाव|टहलना|पैदल)/u,
    ],
  },
];

export interface IntentClassifierInput {
  readonly message: string;
  readonly language: ChatLanguage;
}

export const classifyIntent = (input: IntentClassifierInput): ChatIntent => {
  for (const bank of BANKS) {
    if (bank.patterns.some((re) => re.test(input.message))) {
      return bank.intent;
    }
  }
  return "open_ended";
};
