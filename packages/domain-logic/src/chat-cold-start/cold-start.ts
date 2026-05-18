import type { ChatCondition, ChatIntent, ChatLanguage } from "@swasth/shared-types";
import { lookupTemplate, type TemplateResponse } from "../chat-template-responses/templates.js";

// Cold-start responder (phase3.md A.2 #3). Day 1–14 of a patient's
// journey: there is no usable history yet, so the system can't
// summarise readings or surface patterns. Cold-start substitutes a
// stage-appropriate education message that keeps the user engaged
// instead of returning an empty answer.
//
// Returns null when:
//   - the user is past day 14 (let the normal cost router decide), OR
//   - the intent is intrinsically data-free
//     (`data_explainer`, `lifestyle`, `medication_question`): the
//     existing Tier 1 templates already serve these well and have
//     stage-independent answers.
//
// Important: cold-start NEVER dead-ends. When it does return, it
// returns Tier 1 template content. The returned tier label keeps
// downstream telemetry consistent with chat-cost-router output.

const COLD_START_LAST_DAY = 14 as const;

interface StageMessage {
  hi: string;
  en: string;
  "hi-en": string;
}

// Day-bucket × condition × language. Each bucket maps day ranges per
// CLAUDE.md "Cold Start" copy:
//   Days 1–3  → "Streak shuru" framing
//   Days 4–6  → "Weekly report aane wala hai"
//   Day  7    → "1 hafta — first insights ready"
//   Days 8–14 → "Approaching 2 weeks — full unlock"
//
// Splitting by bucket (vs day-exact) keeps the table small enough to
// hand-author and audit; each bucket gets its own table-driven test.

type StageBucket = "days_1_3" | "days_4_6" | "day_7" | "days_8_14";

const bucketFor = (userStageDays: number): StageBucket => {
  if (userStageDays <= 3) return "days_1_3";
  if (userStageDays <= 6) return "days_4_6";
  if (userStageDays === 7) return "day_7";
  return "days_8_14";
};

const MESSAGES: Readonly<Record<StageBucket, Readonly<Record<ChatCondition, StageMessage>>>> =
  Object.freeze({
    days_1_3: {
      diabetes: {
        hi: "🎉 Streak shuru ho gayi! Roz sugar log karein — 7 din mein pehla weekly chart milega.",
        en: "🎉 Your streak has started! Log sugar daily — your first weekly chart appears after 7 days.",
        "hi-en": "🎉 Streak shuru! Roz sugar log karein — 7 din baad pehla weekly chart milega.",
      },
      bp: {
        hi: "🎉 Streak shuru ho gayi! Roz BP log karein — 7 din mein pehla weekly chart milega.",
        en: "🎉 Your streak has started! Log BP daily — your first weekly chart appears after 7 days.",
        "hi-en": "🎉 Streak shuru! Roz BP log karein — 7 din baad pehla weekly chart milega.",
      },
      multi: {
        hi: "🎉 Streak shuru ho gayi! Roz sugar aur BP log karein — 7 din mein pehla weekly chart milega.",
        en: "🎉 Your streak has started! Log sugar and BP daily — your first weekly chart appears after 7 days.",
        "hi-en":
          "🎉 Streak shuru! Roz sugar aur BP log karein — 7 din baad pehla weekly chart milega.",
      },
    },
    days_4_6: {
      diabetes: {
        hi: "Bahut achcha! Aur 2-3 din ke baad pehla weekly sugar chart milega.",
        en: "Going strong! Two or three more days and your first weekly sugar chart will be ready.",
        "hi-en": "Bahut achcha! 2-3 din aur — phir pehla weekly sugar chart aayega.",
      },
      bp: {
        hi: "Bahut achcha! Aur 2-3 din ke baad pehla weekly BP chart milega.",
        en: "Going strong! Two or three more days and your first weekly BP chart will be ready.",
        "hi-en": "Bahut achcha! 2-3 din aur — phir pehla weekly BP chart aayega.",
      },
      multi: {
        hi: "Bahut achcha! Aur 2-3 din ke baad sugar aur BP dono ka weekly chart milega.",
        en: "Going strong! Two or three more days and your weekly sugar and BP charts will be ready.",
        "hi-en": "Bahut achcha! 2-3 din aur — sugar aur BP dono ka weekly chart aayega.",
      },
    },
    day_7: {
      diabetes: {
        hi: "🔥 1 hafta complete! Aapki pehli weekly insights ab dashboard pe dikh rahi hain.",
        en: "🔥 One week complete! Your first weekly insights are now on the dashboard.",
        "hi-en": "🔥 1 hafta complete! Pehli weekly insights dashboard pe aa gayi hain.",
      },
      bp: {
        hi: "🔥 1 hafta complete! Aapki pehli BP insights ab dashboard pe dikh rahi hain.",
        en: "🔥 One week complete! Your first BP insights are now on the dashboard.",
        "hi-en": "🔥 1 hafta complete! Pehli BP insights dashboard pe aa gayi hain.",
      },
      multi: {
        hi: "🔥 1 hafta complete! Sugar aur BP dono ki pehli weekly insights ab dashboard pe hain.",
        en: "🔥 One week complete! Your first weekly insights for sugar and BP are now on the dashboard.",
        "hi-en":
          "🔥 1 hafta complete! Sugar aur BP dono ki pehli weekly insights dashboard pe hain.",
      },
    },
    days_8_14: {
      diabetes: {
        hi: "📊 Day 14 ke baad full insights unlock honge — patterns, trends, sab. Tab tak roz log karte rahein.",
        en: "📊 Full insights — patterns, trends, all of it — unlock on day 14. Keep logging daily until then.",
        "hi-en":
          "📊 Day 14 ke baad full insights unlock honge — patterns, trends, sab. Roz log karte rahein.",
      },
      bp: {
        hi: "📊 Day 14 ke baad full BP insights unlock honge — trends aur patterns. Roz log karte rahein.",
        en: "📊 Full BP insights — trends and patterns — unlock on day 14. Keep logging daily until then.",
        "hi-en":
          "📊 Day 14 ke baad full BP insights unlock honge — trends aur patterns. Roz log karein.",
      },
      multi: {
        hi: "📊 Day 14 ke baad sugar aur BP dono ke full insights unlock honge. Roz log karte rahein.",
        en: "📊 Day 14 unlocks full insights for both sugar and BP. Keep logging daily.",
        "hi-en": "📊 Day 14 ke baad sugar aur BP dono ke full insights milenge. Roz log karein.",
      },
    },
  });

export interface ColdStartInput {
  userStageDays: number;
  condition: ChatCondition;
  language: ChatLanguage;
  intent: ChatIntent;
}

// Intents that have meaningful answers regardless of how new the user
// is. Cold-start defers to the regular template/router for these.
const DATA_INDEPENDENT_INTENTS: readonly ChatIntent[] = [
  "data_explainer",
  "lifestyle",
  "medication_question",
];

export const coldStartResponse = (input: ColdStartInput): TemplateResponse | null => {
  if (input.userStageDays > COLD_START_LAST_DAY) return null;
  if (DATA_INDEPENDENT_INTENTS.includes(input.intent)) {
    // Let the standard template lookup answer these; cold-start would
    // duplicate copy for no benefit.
    return lookupTemplate({
      intent: input.intent,
      condition: input.condition,
      language: input.language,
    });
  }
  const bucket = bucketFor(input.userStageDays);
  const content = MESSAGES[bucket][input.condition][input.language];
  return { content, tier: "template" };
};
