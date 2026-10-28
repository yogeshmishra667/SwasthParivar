// Server-side notification i18n. Every push title/body string the
// worker layer emits comes through here — that is the single
// chokepoint that respects User.preferredLanguage.
//
// Adding a new language: add a sibling object next to `hi`/`en` below
// and add it to BUNDLES. Adding a new template: add the key to BOTH
// language objects (TypeScript enforces this via the bundle type).
//
// Note: the patient-facing UI strings live in apps/mobile/src/i18n —
// that bundle is separate by design (mobile owns its own asset loading
// + react-i18next runtime). This file is server-only.

import type { Language } from "@prisma/client";

export interface NotifContent {
  title: string;
  body: string;
}

// One builder per template key. Params are typed so each call site
// gets compile-time guarantees about the shape of the substitution
// data. The Hindi bundle is the canonical source for the available
// keys — every other bundle must implement the same surface (the
// `Bundle = typeof hi` line below enforces that).

const hi = {
  critical_bypass_low: (p: { patientName: string; valueMgDl: number }): NotifContent => ({
    title: `⚠️ ${p.patientName}: Sugar Bahut Kam`,
    body: `Sugar ${p.valueMgDl} mg/dL hai. Turant kuch meetha dein — juice ya glucose. Call karein.`,
  }),
  critical_bypass_high: (p: { patientName: string; valueMgDl: number }): NotifContent => ({
    title: `⚠️ ${p.patientName}: Sugar Bahut Zyada`,
    body: `Sugar ${p.valueMgDl} mg/dL hai. Pani peeyein. Dawai check karein. Call karein.`,
  }),
  // Audit P33: a critical reading that synced > 2h after it was taken. Not
  // an emergency alert: says when it was taken and asks to check in.
  // `reading` is a short label, e.g. "Sugar 52 mg/dL" or "BP 190/120".
  critical_late: (p: { patientName: string; reading: string; takenAt: string }): NotifContent => ({
    title: `${p.patientName}: purani reading critical thi`,
    body: `${p.takenAt} baje ki reading: ${p.reading}. Abhi sync hui. Call karke haal poochh lein.`,
  }),
  med_reminder: (p: { medicine: string }): NotifContent => ({
    title: "Dawai ka time",
    body: `${p.medicine} lene ka time ho gaya. Pani ke saath lein 🙏`,
  }),
  best_time: (): NotifContent => ({
    title: "Sugar check karein?",
    body: "Aaj ka log kar lein 🙏",
  }),
  missed_day: (p: { days: number }): NotifContent => ({
    title: `${p.days} din se log nahi`,
    body: "Sab theek? Aaj ek reading le lein.",
  }),
  // Re-engagement copy must NEVER guilt-trip. Tone gradually shifts
  // gentle nudge → caring concern → invitation (CLAUDE.md).
  re_engagement: (p: { days: number }): NotifContent => {
    if (p.days <= 3) {
      return {
        title: `${p.days} din se reading nahi`,
        body: "Sab theek? Aaj ek baar check kar lein 🙏",
      };
    }
    if (p.days <= 5) {
      return {
        title: "Hum yaad kar rahe hain",
        body: `${p.days} din ho gaye — aaj jab time ho, ek reading le lein.`,
      };
    }
    return {
      title: "Wapas aane ka swagat hai",
      body: "Jab ready ho, naya log start kar lein 💪",
    };
  },
  welcome_back: (): NotifContent => ({
    title: "Welcome back!",
    body: "Naya streak shuru karein 💪",
  }),
  streak_risk: (p: { streak: number }): NotifContent => ({
    title: `${p.streak} din ki streak!`,
    body: "Aaj bhi log karein, streak safe rahegi 🔥",
  }),
  generic_morning: (): NotifContent => ({
    title: "Good morning",
    body: "Aaj sugar check karein",
  }),
  // Phase 1 critical_low_high template that the resolver may pick when
  // a critical-bypass event also surfaces via the notification trigger
  // path. The actual critical-bypass push uses `critical_bypass_low/high`
  // — this template is the resolver's generic fallback copy.
  critical_low_high: (): NotifContent => ({
    title: "⚠️ Critical",
    body: "Check reading.",
  }),
  daily_guardian_summary: (p: { yellowCount: number }): NotifContent => ({
    title: "Aaj ka summary",
    body: `${p.yellowCount} baat dhyaan dene layak hai. App mein dekhein.`,
  }),
  sos_active_push: (p: { patientName: string }): NotifContent => ({
    title: `🚨 SOS — ${p.patientName}`,
    body: "App kholein — emergency chal rahi hai.",
  }),
  // Phase 4 Feature E — multi-condition critical-bypass copy. Each
  // category has its own template so the SMS body the family sees
  // matches the actual emergency (bradycardia vs. chest pain vs.
  // asthma red zone). Numeric value(s) inline for situational accuracy.
  critical_bypass_cardiac_low: (p: {
    patientName: string;
    heartRateBpm: number;
  }): NotifContent => ({
    title: `⚠️ ${p.patientName}: Dhadkan Bahut Kam`,
    body: `Heart rate ${p.heartRateBpm} bpm — bahut kam hai. Turant doctor ko call karein.`,
  }),
  critical_bypass_cardiac_high: (p: {
    patientName: string;
    heartRateBpm: number;
  }): NotifContent => ({
    title: `⚠️ ${p.patientName}: Dhadkan Bahut Tez`,
    body: `Heart rate ${p.heartRateBpm} bpm — bahut tez hai. Aaram karein, doctor ko call karein.`,
  }),
  critical_bypass_cardiac_chest_pain: (p: {
    patientName: string;
    painSeverity: number;
  }): NotifContent => ({
    title: `🚨 ${p.patientName}: Seene Mein Dard`,
    body: `Seene mein bahut dard (${p.painSeverity}/10). Turant hospital le jayein ya 108 dial karein.`,
  }),
  critical_bypass_respiratory_peak_flow: (p: {
    patientName: string;
    peakFlow: number;
    baselinePeakFlow: number;
  }): NotifContent => ({
    title: `⚠️ ${p.patientName}: Saans Mein Takleef`,
    body: `Peak flow ${p.peakFlow} (normal ${p.baselinePeakFlow}) — red zone. Inhaler lein, doctor ko call karein.`,
  }),
  critical_bypass_respiratory_severe: (p: { patientName: string }): NotifContent => ({
    title: `🚨 ${p.patientName}: Saans Lene Mein Takleef`,
    body: `Bahut zyada takleef hai. Turant hospital le jayein ya 108 dial karein.`,
  }),
  // CLAUDE.md BP thresholds: low = sys < 90 or dia < 60, high = sys > 180
  // or dia > 110. Both readings inline so the family sees the actual value.
  critical_bypass_bp_low: (p: {
    patientName: string;
    systolic: number;
    diastolic: number;
  }): NotifContent => ({
    title: `⚠️ ${p.patientName}: BP Bahut Kam`,
    body: `BP ${p.systolic}/${p.diastolic} — bahut kam hai. Let jayein, paani peeyein. Turant doctor ko call karein.`,
  }),
  critical_bypass_bp_high: (p: {
    patientName: string;
    systolic: number;
    diastolic: number;
  }): NotifContent => ({
    title: `⚠️ ${p.patientName}: BP Bahut Zyada`,
    body: `BP ${p.systolic}/${p.diastolic} — bahut zyada hai. Aaram se baithein, doctor ko call karein. Seene mein dard ya kamzori ho to 108 dial karein.`,
  }),
  // Phase 4 Feature G.3 — pre-visit appointment reminder. Copy varies by
  // window: the 7d bucket is phrased generically ("aane wali hai") since
  // an appointment booked only 3 days out also lands in it.
  appointment_reminder: (p: { doctorName: string; window: "7d" | "1d" | "2h" }): NotifContent => {
    if (p.window === "2h") {
      return {
        title: "Aaj doctor appointment",
        body: `Aaj ${p.doctorName} ke saath appointment hai — kuch hi ghante mein. Nikalne ki taiyari karein 🙏`,
      };
    }
    if (p.window === "1d") {
      return {
        title: "Kal doctor appointment",
        body: `Kal ${p.doctorName} ke saath appointment hai. Yaad rakhein 🙏`,
      };
    }
    return {
      title: "Doctor appointment aane wali hai",
      body: `${p.doctorName} ke saath appointment aane wali hai. Taiyari kar lein.`,
    };
  },
} as const;

type Bundle = typeof hi;

const en: Bundle = {
  critical_bypass_low: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: Sugar Very Low`,
    body: `Sugar is ${p.valueMgDl} mg/dL. Give them something sweet now — juice or glucose. Call.`,
  }),
  critical_bypass_high: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: Sugar Very High`,
    body: `Sugar is ${p.valueMgDl} mg/dL. Drink water. Check medication. Call.`,
  }),
  critical_late: (p): NotifContent => ({
    title: `${p.patientName}: an earlier reading was critical`,
    body: `Reading from ${p.takenAt}: ${p.reading}. It synced just now. Call to check on them.`,
  }),
  med_reminder: (p): NotifContent => ({
    title: "Medicine time",
    body: `Time for ${p.medicine}. Take with water 🙏`,
  }),
  best_time: (): NotifContent => ({
    title: "Time to check?",
    body: "Log today's reading 🙏",
  }),
  missed_day: (p): NotifContent => ({
    title: `${p.days} day${p.days === 1 ? "" : "s"} without a log`,
    body: "Everything okay? Take one reading today.",
  }),
  re_engagement: (p): NotifContent => {
    if (p.days <= 3) {
      return {
        title: `${p.days} day${p.days === 1 ? "" : "s"} without a reading`,
        body: "Everything okay? Just one check today 🙏",
      };
    }
    if (p.days <= 5) {
      return {
        title: "Thinking of you",
        body: `It's been ${p.days} days — whenever you're ready, take one reading.`,
      };
    }
    return {
      title: "Welcome back",
      body: "Start a fresh log whenever you're ready 💪",
    };
  },
  welcome_back: (): NotifContent => ({
    title: "Welcome back!",
    body: "Start a new streak 💪",
  }),
  streak_risk: (p): NotifContent => ({
    title: `${p.streak}-day streak!`,
    body: "Log today to keep it going 🔥",
  }),
  generic_morning: (): NotifContent => ({
    title: "Good morning",
    body: "Check your sugar today",
  }),
  critical_low_high: (): NotifContent => ({
    title: "⚠️ Critical",
    body: "Check reading.",
  }),
  daily_guardian_summary: (p): NotifContent => ({
    title: "Today's summary",
    body: `${p.yellowCount} thing${p.yellowCount === 1 ? "" : "s"} to look at. Open the app.`,
  }),
  sos_active_push: (p): NotifContent => ({
    title: `🚨 SOS — ${p.patientName}`,
    body: "Open the app — emergency in progress.",
  }),
  critical_bypass_cardiac_low: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: Heart Rate Very Low`,
    body: `Heart rate is ${p.heartRateBpm} bpm — too low. Call the doctor now.`,
  }),
  critical_bypass_cardiac_high: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: Heart Rate Very High`,
    body: `Heart rate is ${p.heartRateBpm} bpm — too high. Rest, call the doctor.`,
  }),
  critical_bypass_cardiac_chest_pain: (p): NotifContent => ({
    title: `🚨 ${p.patientName}: Severe Chest Pain`,
    body: `Severe chest pain (${p.painSeverity}/10). Go to hospital immediately or dial 108.`,
  }),
  critical_bypass_respiratory_peak_flow: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: Breathing Distress`,
    body: `Peak flow ${p.peakFlow} (baseline ${p.baselinePeakFlow}) — red zone. Use inhaler, call doctor.`,
  }),
  critical_bypass_respiratory_severe: (p): NotifContent => ({
    title: `🚨 ${p.patientName}: Severe Breathing Distress`,
    body: `Severe symptoms. Go to hospital immediately or dial 108.`,
  }),
  critical_bypass_bp_low: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: BP Very Low`,
    body: `BP ${p.systolic}/${p.diastolic} — very low. Lie down, drink water. Call the doctor now.`,
  }),
  critical_bypass_bp_high: (p): NotifContent => ({
    title: `⚠️ ${p.patientName}: BP Very High`,
    body: `BP ${p.systolic}/${p.diastolic} — very high. Sit and rest, call the doctor. Chest pain or weakness: dial 108.`,
  }),
  appointment_reminder: (p): NotifContent => {
    if (p.window === "2h") {
      return {
        title: "Doctor visit today",
        body: `You see ${p.doctorName} today — in a few hours. Get ready to leave 🙏`,
      };
    }
    if (p.window === "1d") {
      return {
        title: "Doctor visit tomorrow",
        body: `Tomorrow you see ${p.doctorName}. Don't forget 🙏`,
      };
    }
    return {
      title: "Upcoming doctor visit",
      body: `An appointment with ${p.doctorName} is coming up. Start preparing.`,
    };
  },
};

const BUNDLES: Record<Language, Bundle> = { hi, en };

/**
 * Render a notification template into a {title, body} pair for the
 * given language. Unknown languages fall back to Hindi (the historical
 * default) so a new Language enum value never produces empty pushes.
 */
export const notif = <K extends keyof Bundle>(
  key: K,
  params: Parameters<Bundle[K]>[0],
  lang: Language,
): NotifContent => {
  const bundle = BUNDLES[lang] ?? hi;
  // Cast to a callable shape — TS can't narrow `bundle[key]` to the
  // specific function type that matches `params` when `K` is generic.
  // The bundle type alias guarantees the runtime shape is identical
  // across languages, so this cast is sound.
  const builder = bundle[key] as (p: Parameters<Bundle[K]>[0]) => NotifContent;
  return builder(params);
};

/**
 * Prefix a notification title with the active profile name on a
 * shared-device household. Hindi uses honorific "ji"; English uses a
 * plain colon. Returns the title unchanged when there is no profile
 * to prefix (single-profile household).
 */
export const withProfilePrefix = (
  title: string,
  profileName: string | null,
  lang: Language,
): string => {
  if (!profileName) return title;
  return lang === "hi" ? `${profileName} ji: ${title}` : `${profileName}: ${title}`;
};
