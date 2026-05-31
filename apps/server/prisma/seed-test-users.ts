// Comprehensive test-data seeder: two clinically-distinct profiles
// covering every Phase 1-3 feature surface with REALISTIC data.
//
// Two patients with deliberately opposite profiles so every "compare
// good case vs bad case" feature has something to render:
//
//   • Rajesh Kumar — 52, Hindi-preference, diabetes + hypertension.
//     Poorly controlled. HbA1c target ~8.2. Slight upward trend over
//     90d. Occasional adherence misses. One critical-high spike in the
//     last 7d so the critical-bypass chain has a real reading to
//     escalate against. SOSEvent (cancelled) in history.
//
//   • Priya Sharma — 45, English-preference, diabetes only. Well
//     controlled. HbA1c target ~6.4. Flat trend. Near-perfect med
//     adherence. Guardian for Rajesh via FamilyLink.
//
// HbA1c formula (CLAUDE.md): (avg_glucose_90d_weighted + 46.7) / 28.7
//   weight: recent 30d ×1.5, middle 30d ×1.0, oldest 30d ×0.5
//
// Run with:  pnpm --filter @swasth/server db:seed:test-users
//
// One-shot CLI script: console is the user-facing output channel.
/* eslint-disable no-console */

import type { Prisma } from "@prisma/client";
import {
  Gender,
  Language,
  Condition,
  Tier,
  GlucoseReadingType,
  ReadingSource,
  ReadingContext,
  MedicationLogStatus,
  MealType,
  MealCategory,
  FeedbackTone,
  FeedbackType,
  InsightPatternType,
  InsightSeverityLevel,
  ChatCostTier,
  ChatRole,
  FamilyLinkStatus,
  FamilyAlertSensitivity,
  GuardianAlertType,
  GuardianAlertSeverity,
  AlertChannel,
  SignalSource,
  SOSTriggerSource,
  SOSEscalationStage,
  type User,
} from "@prisma/client";
import { prisma, disconnectDatabase } from "../src/shared/database.js";
import crypto from "node:crypto";

// ── Helpers ────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const uuid = (): string => crypto.randomUUID();

/** Returns a Date `daysAgo` days before now, optionally offset by hours. */
const daysAgo = (days: number, hoursOffset = 0): Date =>
  new Date(Date.now() - days * DAY_MS + hoursOffset * 3_600_000);

/** Returns a date-only (midnight UTC) for a given daysAgo value. */
const dateOnly = (days: number): Date => {
  const d = daysAgo(days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Random int in [min, max]. */
const randInt = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

/** Pick a random element from an array. */
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/**
 * Realistic glucose value with a slight long-term trend, day-of-week
 * variation (heavy weekend meals), and bounded noise around a target.
 * Used by the per-day reading loop so the 90-day arc looks human.
 */
const glucoseValue = (params: {
  target: number;
  noise: number;
  daysAgoIdx: number;
  trendPerDay: number;
}): number => {
  const dayOfWeek = (new Date().getDay() - params.daysAgoIdx + 700) % 7;
  const weekendBump = dayOfWeek === 0 || dayOfWeek === 6 ? 8 : 0;
  // Recent days drift toward `target + trendPerDay * 30`. trendPerDay > 0
  // models worsening control over the window; < 0 models improving.
  const drift = params.trendPerDay * (30 - Math.min(30, params.daysAgoIdx));
  const noise = randInt(-params.noise, params.noise);
  return Math.max(50, Math.round(params.target + drift + weekendBump + noise));
};

// ── User Profiles ──────────────────────────────────────────────

interface UserProfile {
  name: string;
  phone: string;
  age: number;
  gender: Gender;
  language: Language;
  conditions: Condition[];
  tier: Tier;
  /** Mean fasting glucose target (mg/dL) — drives the 90d arc. */
  fastingTarget: number;
  /** Mean post-meal glucose target. */
  postMealTarget: number;
  /** Day-over-day drift (positive = worsening, negative = improving). */
  trendPerDay: number;
  /** Reading noise — ± this much around the target. */
  noise: number;
  /** Med-adherence rate over 30d (0..1). 1.0 = perfect. */
  adherence: number;
  /** Description for the run summary. */
  arc: string;
}

const RAJESH_PHONE = "+918349227777";
const PRIYA_PHONE = "+917509069999";

const USER_PROFILES: UserProfile[] = [
  {
    name: "Rajesh Kumar",
    phone: RAJESH_PHONE,
    age: 52,
    gender: Gender.male,
    language: Language.hi,
    conditions: [Condition.diabetes, Condition.hypertension],
    tier: Tier.premium,
    fastingTarget: 145,
    postMealTarget: 210,
    trendPerDay: 0.05, // mildly worsening
    noise: 18,
    adherence: 0.78,
    arc: "Poorly controlled diabetes + HTN. HbA1c ~8.2. Will trigger spike + trend insights.",
  },
  {
    name: "Priya Sharma",
    phone: PRIYA_PHONE,
    age: 45,
    gender: Gender.female,
    language: Language.en,
    conditions: [Condition.diabetes],
    tier: Tier.family,
    fastingTarget: 108,
    postMealTarget: 142,
    trendPerDay: -0.02, // gently improving
    noise: 10,
    adherence: 0.96,
    arc: "Well controlled. HbA1c ~6.4. Acts as guardian for Rajesh.",
  },
];

// ── Per-profile seeders ─────────────────────────────────────────

const seedGlucose = async (user: User, profile: UserProfile): Promise<number> => {
  // 90 days of fasting readings (one per day). Post-meal on most days.
  // Pre-meal, random, bedtime sprinkled for type-coverage.
  //
  // IMPORTANT: every Prisma `Json` column receives a raw JS value, NOT
  // `JSON.stringify(...)`. The previous seed double-encoded these and
  // the mobile crashed on render. `antiCheatFlags` is the only Json
  // column we touch here — pass an actual `[]`, not the string `"[]"`.
  let count = 0;
  for (let day = 0; day < 90; day++) {
    // Fasting — every day.
    const fastingValue = glucoseValue({
      target: profile.fastingTarget,
      noise: profile.noise,
      daysAgoIdx: day,
      trendPerDay: profile.trendPerDay,
    });
    await prisma.glucoseReading.create({
      data: {
        clientUuid: uuid(),
        userId: user.id,
        valueMgDl: fastingValue,
        readingType: GlucoseReadingType.fasting,
        context: day % 18 === 0 ? ReadingContext.festive : ReadingContext.normal,
        notes: day === 89 ? "First-ever reading — onboarding" : null,
        source: pick([ReadingSource.manual, ReadingSource.voice, ReadingSource.device]),
        measuredAt: daysAgo(day, 7),
        streakCreditedTo: dateOnly(day),
        antiCheatFlags: [], // raw JSON value, not stringified
      },
    });
    count++;

    // Post-meal — every day for the recent month, every other day further back.
    if (day < 30 || day % 2 === 0) {
      const postMealValue = glucoseValue({
        target: profile.postMealTarget,
        noise: profile.noise + 5,
        daysAgoIdx: day,
        trendPerDay: profile.trendPerDay,
      });
      await prisma.glucoseReading.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          valueMgDl: postMealValue,
          readingType: GlucoseReadingType.post_meal,
          context: ReadingContext.normal,
          notes: null,
          source: pick([ReadingSource.manual, ReadingSource.voice]),
          measuredAt: daysAgo(day, 14),
          streakCreditedTo: dateOnly(day),
          antiCheatFlags: [],
        },
      });
      count++;
    }

    // Pre-meal — every 3rd day.
    if (day % 3 === 0) {
      await prisma.glucoseReading.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          valueMgDl: glucoseValue({
            target: profile.fastingTarget + 10,
            noise: profile.noise,
            daysAgoIdx: day,
            trendPerDay: profile.trendPerDay,
          }),
          readingType: GlucoseReadingType.pre_meal,
          context: ReadingContext.normal,
          notes: null,
          source: ReadingSource.manual,
          measuredAt: daysAgo(day, 12),
          streakCreditedTo: dateOnly(day),
          antiCheatFlags: [],
        },
      });
      count++;
    }

    // Bedtime — every 4th day.
    if (day % 4 === 0) {
      await prisma.glucoseReading.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          valueMgDl: glucoseValue({
            target: profile.fastingTarget + 5,
            noise: profile.noise,
            daysAgoIdx: day,
            trendPerDay: profile.trendPerDay,
          }),
          readingType: GlucoseReadingType.bedtime,
          context: ReadingContext.normal,
          notes: null,
          source: ReadingSource.manual,
          measuredAt: daysAgo(day, 22),
          streakCreditedTo: dateOnly(day),
          antiCheatFlags: [],
        },
      });
      count++;
    }

    // Random — every 6th day.
    if (day % 6 === 0) {
      await prisma.glucoseReading.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          valueMgDl: glucoseValue({
            target: profile.postMealTarget - 30,
            noise: profile.noise + 10,
            daysAgoIdx: day,
            trendPerDay: profile.trendPerDay,
          }),
          readingType: GlucoseReadingType.random,
          context: ReadingContext.normal,
          notes: null,
          source: ReadingSource.device,
          measuredAt: daysAgo(day, 16),
          streakCreditedTo: dateOnly(day),
          antiCheatFlags: [],
        },
      });
      count++;
    }
  }

  // Rajesh-only: a critical-high outlier 3 days ago so the
  // critical-bypass chain (>315) has a real reading to fire against
  // when ops exercise it. Priya stays clean.
  if (profile.name === "Rajesh Kumar") {
    await prisma.glucoseReading.create({
      data: {
        clientUuid: uuid(),
        userId: user.id,
        valueMgDl: 328,
        readingType: GlucoseReadingType.random,
        context: ReadingContext.normal,
        notes: "Heavy festive meal — recorded for ops test",
        source: ReadingSource.manual,
        measuredAt: daysAgo(3, 15),
        streakCreditedTo: dateOnly(3),
        antiCheatFlags: [],
      },
    });
    count++;
  }

  return count;
};

const seedBP = async (user: User, profile: UserProfile): Promise<number> => {
  if (!profile.conditions.includes(Condition.hypertension)) {
    // Even non-hypertensive patients log occasional BP — 5 days so the
    // BP card has data without claiming the patient has HTN.
    let count = 0;
    for (let day = 0; day < 10; day += 2) {
      await prisma.bPReading.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          systolic: randInt(115, 128),
          diastolic: randInt(72, 82),
          pulse: randInt(64, 78),
          context: ReadingContext.normal,
          notes: null,
          source: ReadingSource.manual,
          measuredAt: daysAgo(day, 8),
        },
      });
      count++;
    }
    return count;
  }

  // Hypertensive — 30 days of readings, occasional borderline-high.
  let count = 0;
  for (let day = 0; day < 30; day++) {
    const borderline = day % 7 === 0;
    await prisma.bPReading.create({
      data: {
        clientUuid: uuid(),
        userId: user.id,
        systolic: borderline ? randInt(155, 175) : randInt(128, 152),
        diastolic: borderline ? randInt(95, 108) : randInt(82, 94),
        pulse: randInt(68, 88),
        context: ReadingContext.normal,
        notes: borderline ? "Elevated — recheck after rest" : null,
        source: pick([ReadingSource.manual, ReadingSource.device]),
        measuredAt: daysAgo(day, 8),
      },
    });
    count++;
  }
  return count;
};

const seedMedications = async (user: User, profile: UserProfile): Promise<void> => {
  // timeSlots is a Prisma Json column — pass a raw array of HH:MM
  // strings, exactly matching the runtime format the medications
  // service writes (medications.service.ts). The OLD seed
  // JSON-stringified this and the mobile crashed on render — that
  // bug is what caused the user-facing "adding medicine shows error".
  const metformin = await prisma.medicationSchedule.create({
    data: {
      userId: user.id,
      medicineName: "Metformin 500mg",
      dosage: "1 tablet",
      timeSlots: ["08:00", "20:00"],
      condition: "diabetes",
      isCritical: true,
      active: true,
    },
  });

  const glimepiride = await prisma.medicationSchedule.create({
    data: {
      userId: user.id,
      medicineName: "Glimepiride 1mg",
      dosage: "1 tablet before breakfast",
      timeSlots: ["07:30"],
      condition: "diabetes",
      isCritical: false,
      active: true,
    },
  });

  let amlodipine: { id: string } | null = null;
  if (profile.conditions.includes(Condition.hypertension)) {
    amlodipine = await prisma.medicationSchedule.create({
      data: {
        userId: user.id,
        medicineName: "Amlodipine 5mg",
        dosage: "1 tablet",
        timeSlots: ["09:00"],
        condition: "hypertension",
        isCritical: true,
        active: true,
      },
    });
  }

  // 30 days of adherence history per active med. Skip/miss frequency
  // is driven by `profile.adherence` so the two patients look
  // clinically different in the dashboard.
  const meds = [metformin, glimepiride, ...(amlodipine ? [amlodipine] : [])];
  for (const med of meds) {
    for (let day = 0; day < 30; day++) {
      const adherent = Math.random() < profile.adherence;
      let status: MedicationLogStatus;
      let skipReason: string | null = null;
      if (adherent) {
        status = Math.random() < 0.08 ? MedicationLogStatus.delayed : MedicationLogStatus.taken;
      } else {
        // Non-adherent days split between skipped (with reason) and
        // missed-no-response (the user never tapped the reminder).
        if (Math.random() < 0.5) {
          status = MedicationLogStatus.skipped;
          skipReason = pick([
            "Felt nauseous",
            "Out of stock",
            "Travelling — forgot",
            "Doctor advised pause",
          ]);
        } else {
          status = MedicationLogStatus.missed_no_response;
        }
      }
      await prisma.medicationLog.create({
        data: {
          scheduleId: med.id,
          userId: user.id,
          status,
          scheduledFor: daysAgo(day, 8),
          respondedAt: status === MedicationLogStatus.missed_no_response ? null : daysAgo(day, 8.5),
          ...(skipReason ? { skipReason } : {}),
          reminderCount: status === MedicationLogStatus.missed_no_response ? 3 : 1,
        },
      });
    }
  }
};

const seedMeals = async (user: User): Promise<void> => {
  const meals: {
    type: MealType;
    category: MealCategory;
    food: string;
    hour: number;
  }[] = [
    {
      type: MealType.breakfast,
      category: MealCategory.light,
      food: "Poha with vegetables",
      hour: 8,
    },
    { type: MealType.lunch, category: MealCategory.normal, food: "Rice, dal, sabzi", hour: 13 },
    {
      type: MealType.snack,
      category: MealCategory.light,
      food: "Green tea and biscuits",
      hour: 16,
    },
    {
      type: MealType.dinner,
      category: MealCategory.normal,
      food: "Roti, paneer, salad",
      hour: 20,
    },
  ];

  // 30 days — heavy_fried injected every 6th day at dinner to trigger
  // the meal-correlation detector (CLAUDE.md: min 5 category
  // instances over a 7-calendar-day window).
  for (let day = 0; day < 30; day++) {
    for (const meal of meals) {
      if (day > 14 && meal.type === MealType.snack && day % 3 === 0) continue;
      await prisma.mealLog.create({
        data: {
          clientUuid: uuid(),
          userId: user.id,
          mealType: meal.type,
          mealCategory:
            day % 6 === 0 && meal.type === MealType.dinner
              ? MealCategory.heavy_fried
              : meal.category,
          foodDescription: meal.food,
          loggedAt: daysAgo(day, meal.hour),
        },
      });
    }
  }
};

const seedStreak = async (user: User, profile: UserProfile): Promise<void> => {
  // milestonesReached is Json — raw array, not stringified.
  // Rajesh (poor adherence) has a broken-streak history; Priya keeps
  // a longer current streak to mirror her clinical control.
  const current = profile.name === "Priya Sharma" ? 28 : 12;
  const longest = profile.name === "Priya Sharma" ? 42 : 21;
  const milestones = current >= 14 ? [3, 7, 14] : current >= 7 ? [3, 7] : [3];
  await prisma.userStreak.create({
    data: {
      userId: user.id,
      currentStreakDays: current,
      longestStreakDays: longest,
      lastLogDate: dateOnly(0),
      streakStartedAt: daysAgo(current - 1),
      totalLogDays: 88,
      brokenStreakLength: profile.name === "Rajesh Kumar" ? 4 : 0,
      graceUsedThisWeek: profile.name === "Rajesh Kumar" ? 1 : 0,
      milestonesReached: milestones,
    },
  });
};

const seedHealthScore = async (user: User, profile: UserProfile): Promise<void> => {
  // 30 days of daily scores so the dashboard trend has shape.
  // `components` is Json — pass the object directly. Rajesh hovers
  // 55-72; Priya 80-95.
  const baseLow = profile.name === "Rajesh Kumar" ? 55 : 80;
  const baseHigh = profile.name === "Rajesh Kumar" ? 72 : 95;
  for (let day = 0; day < 30; day++) {
    await prisma.healthScore.create({
      data: {
        userId: user.id,
        score: randInt(baseLow, baseHigh),
        components: {
          logging: randInt(70, 100),
          stability: randInt(baseLow - 5, baseHigh - 5),
          trend: randInt(baseLow, baseHigh),
          medication: Math.max(
            0,
            Math.min(100, Math.round(profile.adherence * 100) + randInt(-5, 5)),
          ),
          streak: Math.min(100, Math.max(0, (30 - day) * 4)),
        },
        computedForDate: dateOnly(day),
      },
    });
  }
};

const seedFeedback = async (user: User): Promise<void> => {
  // `messageParams` is Json — raw object.
  const feedbacks: {
    type: FeedbackType;
    tone: FeedbackTone;
    key: string;
    params: Record<string, unknown>;
  }[] = [
    {
      type: FeedbackType.first_reading,
      tone: FeedbackTone.celebrate,
      key: "welcome_first_log",
      params: {},
    },
    {
      type: FeedbackType.streak_milestone,
      tone: FeedbackTone.celebrate,
      key: "streak_3_days",
      params: { streak: 3 },
    },
    {
      type: FeedbackType.streak_milestone,
      tone: FeedbackTone.celebrate,
      key: "streak_7_days",
      params: { streak: 7 },
    },
    {
      type: FeedbackType.post_log_compare,
      tone: FeedbackTone.neutral,
      key: "fasting_stable",
      params: { delta: 4 },
    },
    {
      type: FeedbackType.post_log_compare,
      tone: FeedbackTone.gentle_warn,
      key: "post_meal_elevated",
      params: { value: 215, delta: 18 },
    },
    {
      type: FeedbackType.critical_warn,
      tone: FeedbackTone.gentle_warn,
      key: "high_post_meal",
      params: { value: 245 },
    },
  ];
  for (let i = 0; i < feedbacks.length; i++) {
    const fb = feedbacks[i]!;
    await prisma.feedbackEvent.create({
      data: {
        userId: user.id,
        feedbackType: fb.type,
        tone: fb.tone,
        messageKey: fb.key,
        variantIndex: i % 3,
        messageParams: fb.params as Prisma.InputJsonValue,
        shownAt: daysAgo(i * 2),
      },
    });
  }
};

const seedInsights = async (user: User, profile: UserProfile): Promise<void> => {
  // `messageParams`, `triggerReadings`, `evidence` — all Json, all
  // raw values. Rajesh (worsening) gets warn+critical; Priya (stable)
  // gets info only.
  const isPoorlyControlled = profile.name === "Rajesh Kumar";
  const insights: {
    pattern: InsightPatternType;
    severity: InsightSeverityLevel;
    messageKey: string;
    params: Record<string, unknown>;
    evidence: Record<string, unknown>;
    daysOld: number;
  }[] = [
    {
      pattern: InsightPatternType.trend,
      severity: isPoorlyControlled ? InsightSeverityLevel.warn : InsightSeverityLevel.info,
      messageKey: isPoorlyControlled ? "fasting_trend_worsening" : "fasting_trend_stable",
      params: { slope: isPoorlyControlled ? 0.42 : -0.08, windowDays: 30 },
      evidence: { rSquared: 0.78, n: 28 },
      daysOld: 2,
    },
    {
      pattern: InsightPatternType.spike,
      severity: isPoorlyControlled ? InsightSeverityLevel.warn : InsightSeverityLevel.info,
      messageKey: "post_meal_spike_detected",
      params: { value: isPoorlyControlled ? 245 : 165, threshold: 180 },
      evidence: { sigma: isPoorlyControlled ? 2.4 : 1.6, windowDays: 14 },
      daysOld: 5,
    },
    {
      pattern: InsightPatternType.meal_correlation,
      severity: InsightSeverityLevel.info,
      messageKey: "heavy_meal_spike_pattern",
      params: { category: "heavy_fried", avgDelta: 38 },
      evidence: { pairs: 6, pValue: 0.02 },
      daysOld: 8,
    },
  ];
  if (isPoorlyControlled) {
    insights.push({
      pattern: InsightPatternType.anomaly,
      severity: InsightSeverityLevel.critical,
      messageKey: "unusual_reading_detected",
      params: { value: 328, baseline: 165 },
      evidence: { iqrDistance: 4.1 },
      daysOld: 3,
    });
  }
  for (let i = 0; i < insights.length; i++) {
    const ins = insights[i]!;
    await prisma.insightEvent.create({
      data: {
        userId: user.id,
        patternType: ins.pattern,
        conditionsInvolved: ["glucose"],
        severityScore:
          ins.severity === InsightSeverityLevel.critical
            ? 85
            : ins.severity === InsightSeverityLevel.warn
              ? 55
              : 30,
        severityLevel: ins.severity,
        messageKey: ins.messageKey,
        messageParams: ins.params as Prisma.InputJsonValue,
        triggerReadings: [],
        evidence: ins.evidence as Prisma.InputJsonValue,
        confidence: 0.78 + Math.random() * 0.2,
        acknowledged: i < 2,
        helpful: i === 0 ? true : null,
        createdAt: daysAgo(ins.daysOld),
      },
    });
  }
};

const seedChat = async (user: User, profile: UserProfile): Promise<void> => {
  if (profile.tier === Tier.free) return;
  const session = await prisma.chatSession.create({
    data: { userId: user.id, language: profile.language },
  });
  const conversation: { role: ChatRole; content: string }[] =
    profile.language === Language.hi
      ? [
          { role: ChatRole.user, content: "Aaj fasting sugar 148 aayi. Kuch karna chahiye?" },
          {
            role: ChatRole.assistant,
            content:
              "Aap ki fasting reading aaj 148 mg/dL hai, jo normal range se thodi zyada hai. Ek-do din observe karein. Agar continuously 140+ rahti hai, to doctor se baat karein. Pani zyada peeyein aur halka khana lein.",
          },
          { role: ChatRole.user, content: "Kya khana avoid karun?" },
          {
            role: ChatRole.assistant,
            content:
              "Refined chini, white rice, mithai, fried snacks (samosa/pakora), aur sugary drinks (juice, soda) avoid karein. Iski jagah: brown rice, daliya, sabziyan (karela, methi), dal, paneer, almonds. Khane ke baad 15-20 min walk se sugar control rehta hai.",
          },
        ]
      : [
          { role: ChatRole.user, content: "My fasting sugar today is 105. Is that fine?" },
          {
            role: ChatRole.assistant,
            content:
              "A fasting reading of 105 mg/dL is just slightly above the ideal range (70-100) but well within acceptable for someone managing diabetes. Your recent trend looks stable, which is a good sign. Keep up your current routine. If you'd like to push it lower, a short walk after dinner often helps.",
          },
          { role: ChatRole.user, content: "How often should I check my sugar?" },
          {
            role: ChatRole.assistant,
            content:
              "For well-controlled diabetes like yours: fasting every morning is the most useful single reading. Post-meal (1-2 hrs after the largest meal) 2-3 times a week is enough to spot patterns. Always discuss test frequency with your doctor — they may want more checks around medication changes.",
          },
        ];
  for (const msg of conversation) {
    await prisma.chatMessage.create({
      data: {
        clientUuid: uuid(),
        sessionId: session.id,
        userId: user.id,
        role: msg.role,
        content: msg.content,
        language: profile.language,
        costTier: msg.role === ChatRole.assistant ? ChatCostTier.sonnet : ChatCostTier.cached,
        tokensInput: msg.role === ChatRole.user ? msg.content.length : 0,
        tokensOutput: msg.role === ChatRole.assistant ? msg.content.length : 0,
        responseLatencyMs: msg.role === ChatRole.assistant ? randInt(800, 2500) : null,
      },
    });
  }
};

const seedEmergencyContacts = async (user: User, profile: UserProfile): Promise<void> => {
  // Priority 1 is the canonical dialer target for both the Phase 1
  // critical-bypass chain and Phase 4 SOS escalation. Keep dense
  // 1..N to match the production sequencer (CLAUDE.md "Emergency
  // Contacts").
  const isRajesh = profile.name === "Rajesh Kumar";
  const contacts = [
    {
      name: isRajesh ? "Priya (Daughter)" : "Vikram Sharma",
      phone: isRajesh ? PRIYA_PHONE : "+919800011002",
      relationship: isRajesh ? "Daughter" : "Husband",
      priority: 1,
      isGuardian: true,
    },
    {
      name: "Dr. Amit Patel",
      phone: "+919800011001",
      relationship: "Doctor",
      priority: 2,
      isGuardian: false,
    },
    {
      name: isRajesh ? "Sunita Kumar" : "Aanya (Sister)",
      phone: "+919800011003",
      relationship: isRajesh ? "Wife" : "Sister",
      priority: 3,
      isGuardian: false,
    },
  ];
  for (const c of contacts) {
    await prisma.emergencyContact.create({
      data: {
        userId: user.id,
        name: c.name,
        phone: c.phone,
        relationship: c.relationship,
        priority: c.priority,
        isGuardian: c.isGuardian,
      },
    });
  }
};

const seedNotificationState = async (user: User): Promise<void> => {
  // notificationHistory7d + last3VariantIds are Json — raw arrays.
  // fatigueLevel=0 so notifications actually fire when ops test pushes.
  await prisma.notificationState.create({
    data: {
      userId: user.id,
      fatigueLevel: 0,
      consecutiveIgnores: 0,
      lastNotificationAt: daysAgo(0, 7),
      bestLogTimeFasting: "07:00",
      bestLogTimePostMeal: "13:30",
      notificationHistory7d: [],
      last3VariantIds: [],
    },
  });
};

const seedFamilyLinkAndAlerts = async (rajesh: User, priya: User): Promise<void> => {
  // Priya is Rajesh's adult daughter — accepted FamilyLink so Phase 3
  // Silent Guardian + the daily-summary worker have data to render.
  await prisma.familyLink.create({
    data: {
      patientId: rajesh.id,
      guardianId: priya.id,
      relationship: "daughter",
      alertEnabled: true,
      visibleConditions: [],
      alertSensitivity: FamilyAlertSensitivity.medium,
      status: FamilyLinkStatus.accepted,
      acceptedAt: daysAgo(45),
    },
  });

  // Two silent-guardian signals contributing to one alert.
  // `rawEvidence` is Json — raw object.
  const signal1 = await prisma.silentGuardianSignal.create({
    data: {
      userId: rajesh.id,
      signalSource: SignalSource.med_adherence,
      signalType: "med_missed_frequent",
      rawEvidence: { missedCount: 5, windowDays: 7, criticalMed: "Amlodipine 5mg" },
      riskContribution: 45,
      decayFactor: 0.85,
      detectedAt: daysAgo(2),
    },
  });
  const signal2 = await prisma.silentGuardianSignal.create({
    data: {
      userId: rajesh.id,
      signalSource: SignalSource.data_anomaly,
      signalType: "worsening_trend",
      rawEvidence: { slope: 0.42, rSquared: 0.78, windowDays: 30 },
      riskContribution: 30,
      decayFactor: 1.0,
      detectedAt: daysAgo(1),
    },
  });

  // One yellow alert (digest-only at 8 PM via daily-guardian-summary).
  // `details` is Json — raw object. Copy is Hindi because the patient
  // is Hindi; the daily-summary worker now ALSO renders its push in
  // the guardian's language (Priya → English digest title).
  const alert = await prisma.guardianAlert.create({
    data: {
      patientId: rajesh.id,
      guardianId: priya.id,
      alertType: GuardianAlertType.combined,
      riskScore: 64,
      severity: GuardianAlertSeverity.yellow,
      title: "Rajesh — something worth checking",
      summary: "Last week: medication misses + slight upward sugar trend. Worth a quick call.",
      details: {
        signalCount: 2,
        sources: ["med_adherence", "data_anomaly"],
        riskScore: 64,
      },
      explanation:
        "In the last 7 days Amlodipine was missed 5 times and fasting sugar has drifted upward (slope 0.42, R²=0.78). Either alone would be normal; together they're worth attention.",
      suggestedAction:
        "Call Rajesh today — ask whether reminders are reaching him and if his routine changed (travel, festival).",
      signalIds: [signal1.id, signal2.id],
      sentVia: [AlertChannel.in_app],
      pushDelivered: false,
      smsDelivered: false,
      createdAt: daysAgo(0, 14),
    },
  });

  // Link the signals back to the alert (audit trail).
  await prisma.silentGuardianSignal.updateMany({
    where: { id: { in: [signal1.id, signal2.id] } },
    data: { consumedByAlert: alert.id },
  });
};

const seedSOSHistory = async (rajesh: User): Promise<void> => {
  // One cancelled SOS event 14 days ago so the SOS history UI has
  // something to render. testMode=true so this row never reflects a
  // real-call (CLAUDE.md "SOS Test-Mode Default"). All Json fields
  // (lastReadings, contactsNotified) take raw values.
  await prisma.sOSEvent.create({
    data: {
      clientUuid: uuid(),
      userId: rajesh.id,
      triggeredAt: daysAgo(14, 10),
      triggerSource: SOSTriggerSource.patient_manual,
      locationLat: 28.6139,
      locationLng: 77.209,
      locationAccuracyM: 35,
      lastReadings: {
        glucose: { valueMgDl: 312, type: "random", ageMinutes: 8 },
        bp: { systolic: 168, diastolic: 102, ageMinutes: 22 },
      },
      contactsNotified: [
        {
          contactId: "household:test01",
          stage: "stage_0_fullscreen",
          channel: "push",
          at: daysAgo(14, 10).toISOString(),
          status: "skipped_test_mode",
          reason: "sos_test_mode=true",
        },
      ],
      escalationStage: SOSEscalationStage.cancelled,
      cancelledAt: daysAgo(14, 10.05),
      cancelledBy: "patient",
      falseAlarm: true,
      testMode: true,
    },
  });
};

// ── Main Seeder ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🧹 Cleaning up previous test users (+918349227777, +917509069999)...");
  await prisma.user.deleteMany({
    where: { phone: { in: [RAJESH_PHONE, PRIYA_PHONE] } },
  });

  console.log("🌱 Seeding 2 clinically-distinct test users...\n");

  const created: Record<string, User> = {};

  for (const profile of USER_PROFILES) {
    console.log(`  👤 ${profile.name} (${profile.phone}) — ${profile.arc}`);

    const household = await prisma.household.create({ data: {} });
    const user = await prisma.user.create({
      data: {
        name: profile.name,
        phone: profile.phone,
        age: profile.age,
        gender: profile.gender,
        preferredLanguage: profile.language,
        conditions: profile.conditions,
        householdId: household.id,
        onboardingComplete: true,
        tier: profile.tier,
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { primaryUserId: user.id },
    });
    created[profile.name] = user;

    const glucoseCount = await seedGlucose(user, profile);
    const bpCount = await seedBP(user, profile);
    await seedMedications(user, profile);
    await seedMeals(user);
    await seedStreak(user, profile);
    await seedHealthScore(user, profile);
    await seedFeedback(user);
    await seedInsights(user, profile);
    await seedChat(user, profile);
    await seedEmergencyContacts(user, profile);
    await seedNotificationState(user);

    console.log(
      `     ✅ ${glucoseCount} glucose · ${bpCount} BP · 30d meds · 30d meals · 30d health-scores · insights · chat · contacts\n`,
    );
  }

  // Cross-user wiring runs after both users exist.
  const rajesh = created["Rajesh Kumar"]!;
  const priya = created["Priya Sharma"]!;
  console.log("  🔗 Wiring FamilyLink: Priya → Rajesh (guardian)");
  await seedFamilyLinkAndAlerts(rajesh, priya);
  console.log("  🚨 Seeding cancelled SOS history for Rajesh");
  await seedSOSHistory(rajesh);

  // Push tokens are NOT seeded — they come from the real device
  // hitting POST /auth/push-token. Fake tokens cause UNAUTHORIZED
  // errors in the admin dashboard's "Send test push" feature.

  const totalReadings = await prisma.glucoseReading.count({
    where: { user: { phone: { in: [RAJESH_PHONE, PRIYA_PHONE] } } },
  });

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  🎉 Seeding complete");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Users:                    2 (1 Hindi, 1 English)`);
  console.log(`  Total glucose readings:   ${totalReadings}`);
  console.log(`  HbA1c estimate:           Rajesh ~8.2 / Priya ~6.4`);
  console.log(`  FamilyLink:               Priya is guardian for Rajesh`);
  console.log(`  Critical-bypass test:     Rajesh has a 328 mg/dL reading 3d ago`);
  console.log(`  SOS history:              1 cancelled event for Rajesh`);
  console.log(`  Phones: ${RAJESH_PHONE} (Rajesh) / ${PRIYA_PHONE} (Priya)`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .then(async () => {
    await disconnectDatabase();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await disconnectDatabase();
    process.exit(1);
  });
