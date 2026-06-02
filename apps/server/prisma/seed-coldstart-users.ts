// Cold-start test users — one per unlock window so the UI gates
// (insights/HbA1c lock cards, day-7 spike unlock, day-14 full unlock,
// readings rate limit) can each be exercised against a real account.
//
// Companion to `seed-test-users.ts` (Rajesh + Priya, 90-day arcs).
// That file covers the "what does a power user look like" surfaces;
// this one covers the "what does brand-new look like" ones.
//
// Profile matrix:
//
//   Day  0 — Anil Verma           — locked insights, locked HbA1c, no readings
//   Day  3 — Sunita Devi          — 3 days into streak, locked insights
//   Day  7 — Vikram Singh         — spike detector active, day-7 milestone
//   Day 13 — Lakshmi Iyer         — one day before HbA1c unlock
//   Day  7 — Rajesh Kumar  ←──── shared phone with seed-test-users.ts
//   Day 35 — Priya Sharma  ←──── shared phone with seed-test-users.ts
//
// All six are Tier.free so they exercise the daily-readings rate
// limit (rate_limit.readings.free) which premium/family users bypass.
// All have onboardingComplete=true so they land on the dashboard, not
// the onboarding flow.
//
// Phone overlap with seed-test-users.ts: Rajesh (+918349227777) and
// Priya (+917509069999) appear in BOTH seeds. Whichever seed runs last
// wins — running this cold-start seed overwrites their 90-day arcs;
// running `db:seed:test-users` afterwards flips them back. The cleanup
// step here deletes-by-phone so re-runs are idempotent in either order.
//
// Run with:  pnpm --filter @swasth/server db:seed:coldstart-users
//
// One-shot CLI script: console is the user-facing output channel.
/* eslint-disable no-console */

import {
  Gender,
  Language,
  Condition,
  Tier,
  GlucoseReadingType,
  ReadingSource,
  ReadingContext,
  type User,
} from "@prisma/client";
import { prisma, disconnectDatabase } from "../src/shared/database.js";
import crypto from "node:crypto";

// ── Helpers (duplicated from seed-test-users for self-containment) ──

const DAY_MS = 86_400_000;
const uuid = (): string => crypto.randomUUID();

/** Returns a Date `daysAgo` days before now, with optional hours offset. */
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

/** Realistic fasting glucose ± noise around a target. */
const glucoseValue = (target: number, noise: number): number =>
  Math.max(50, Math.round(target + randInt(-noise, noise)));

// ── Profile spec ─────────────────────────────────────────────────────

interface ColdStartProfile {
  name: string;
  phone: string;
  age: number;
  gender: Gender;
  language: Language;
  conditions: Condition[];
  /** How many days ago the account was created. Drives `createdAt`. */
  stageDays: number;
  /** How many fasting readings to seed (spread across the stage window). */
  readingCount: number;
  /** Target fasting value; readings drift ±noise around this. */
  fastingTarget: number;
  noise: number;
  /** Short description for the run summary. */
  arc: string;
}

const PROFILES: ColdStartProfile[] = [
  {
    name: "Anil Verma",
    phone: "+919800000000",
    age: 58,
    gender: Gender.male,
    language: Language.hi,
    conditions: [Condition.diabetes],
    stageDays: 0,
    readingCount: 0,
    fastingTarget: 130,
    noise: 12,
    arc: "Day 0 — just registered. Locked insights + HbA1c. No readings.",
  },
  {
    name: "Sunita Devi",
    phone: "+919800000003",
    age: 62,
    gender: Gender.female,
    language: Language.hi,
    conditions: [Condition.diabetes],
    stageDays: 3,
    readingCount: 4,
    fastingTarget: 125,
    noise: 10,
    arc: "Day 3 — locked insights, 3-day streak progress, lock card at 21%.",
  },
  {
    name: "Vikram Singh",
    phone: "+919800000007",
    age: 55,
    gender: Gender.male,
    language: Language.hi,
    conditions: [Condition.diabetes, Condition.hypertension],
    stageDays: 7,
    readingCount: 10,
    fastingTarget: 140,
    noise: 15,
    arc: "Day 7 — first weekly median lands, spike detector activates.",
  },
  {
    name: "Lakshmi Iyer",
    phone: "+919800000013",
    age: 49,
    gender: Gender.female,
    language: Language.en,
    conditions: [Condition.diabetes],
    stageDays: 13,
    readingCount: 22,
    fastingTarget: 118,
    noise: 8,
    arc: "Day 13 — one day before HbA1c unlock + insights unlock.",
  },
  // ─── Cold-start variants on the seed-test-users phone numbers ───
  // Same phones as Rajesh/Priya in seed-test-users.ts (the familiar
  // numbers for testing) but with cold-start data. Whichever seed
  // runs last wins; either is idempotent on re-run.
  {
    name: "Rajesh Kumar",
    phone: "+918349227777",
    age: 52,
    gender: Gender.male,
    language: Language.hi,
    conditions: [Condition.diabetes, Condition.hypertension],
    stageDays: 7,
    readingCount: 10,
    // Higher target + wider noise → his "poorly controlled" profile
    // still reads through even at the shorter cold-start window.
    fastingTarget: 145,
    noise: 18,
    arc: "Day 7 — spike detector unlocks; diabetes + HTN; poorly controlled arc.",
  },
  {
    name: "Priya Sharma",
    phone: "+917509069999",
    age: 45,
    gender: Gender.female,
    language: Language.en,
    conditions: [Condition.diabetes],
    stageDays: 35,
    readingCount: 60,
    // Lower target + tighter noise → her "well-controlled" profile,
    // positioned well past the day-14 full unlock so HbA1c estimate
    // (needs ≥30 readings in 90d) + 30-day trend detector both fire.
    fastingTarget: 108,
    noise: 10,
    arc: "Day 35 — full unlock; HbA1c estimate available; trend detector live.",
  },
];

// ── Per-profile seeders ──────────────────────────────────────────────

/**
 * Seed `n` fasting readings spread across the stage window. Day 0 gets
 * zero — we explicitly want an empty-state account. For non-zero stages
 * the loop walks day-by-day from the oldest to today, distributing
 * readings as evenly as possible (typically 1–2 per day).
 */
const seedReadings = async (user: User, profile: ColdStartProfile): Promise<number> => {
  if (profile.readingCount === 0) return 0;

  // Build an array of "daysAgo" indices, evenly spaced inside the
  // [0, stageDays] window. The user's first reading is on the day they
  // signed up (stageDays back); the most recent is today.
  const indices: number[] = [];
  for (let i = 0; i < profile.readingCount; i++) {
    // Linear interpolation between stageDays-1 and 0. Floor so a reading
    // can't land "before" account creation.
    const t = profile.readingCount === 1 ? 0 : i / (profile.readingCount - 1);
    const day = Math.floor(profile.stageDays * (1 - t));
    indices.push(day);
  }

  const TYPES: GlucoseReadingType[] = [
    GlucoseReadingType.fasting,
    GlucoseReadingType.post_meal,
    GlucoseReadingType.bedtime,
  ];

  let count = 0;
  for (let i = 0; i < indices.length; i++) {
    const day = indices[i]!;
    // Spread the within-day timestamps so multiple readings the same
    // day don't collide AND every measuredAt is in the past — using
    // negative offsets relative to "now" keeps day-0 readings from
    // landing in the future on a race.
    const hourOffset = -((i % 3) * 6 + 2);
    await prisma.glucoseReading.create({
      data: {
        clientUuid: uuid(),
        userId: user.id,
        valueMgDl: glucoseValue(profile.fastingTarget, profile.noise),
        readingType: TYPES[i % 3]!,
        context: ReadingContext.normal,
        notes: null,
        source: ReadingSource.manual,
        measuredAt: daysAgo(day, hourOffset),
        streakCreditedTo: dateOnly(day),
        antiCheatFlags: [],
      },
    });
    count++;
  }
  return count;
};

/**
 * Seed a UserStreak row. Streak = number of distinct days the user has
 * logged, capped by the readings array. Day 0 users get a zero-streak
 * row so the dashboard streak card has something to read.
 */
const seedStreak = async (user: User, profile: ColdStartProfile): Promise<void> => {
  const distinctDays =
    profile.readingCount === 0 ? 0 : Math.min(profile.stageDays + 1, profile.readingCount);
  await prisma.userStreak.create({
    data: {
      userId: user.id,
      currentStreakDays: distinctDays,
      longestStreakDays: distinctDays,
      totalLogDays: distinctDays,
      ...(distinctDays > 0
        ? {
            lastLogDate: dateOnly(0),
            streakStartedAt: daysAgo(profile.stageDays),
          }
        : {}),
      milestonesReached: [],
    },
  });
};

// ── Run ──────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const phones = PROFILES.map((p) => p.phone);

  console.log("🧹 Cleaning up previous cold-start users...");
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });

  console.log("🌱 Seeding 4 cold-start test users (Tier.free)...\n");

  for (const profile of PROFILES) {
    console.log(
      `  👤 Day ${profile.stageDays.toString().padStart(2)} — ${profile.name} (${profile.phone})`,
    );
    console.log(`     ${profile.arc}`);

    const household = await prisma.household.create({ data: {} });

    // Account creation date — the key field that drives every
    // userStageDays gate in the mobile app. Mobile computes
    // `Math.floor((now - createdAt) / 86_400_000)`, so we need
    // createdAt to be at least N full days in the past for stage N.
    // Subtract 1hr to land safely on the right side of the floor()
    // boundary (day-0 → 1hr-ago → floor((1hr)/day)=0, not -1).
    const accountCreatedAt = daysAgo(profile.stageDays, -1);

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
        tier: Tier.free,
        createdAt: accountCreatedAt,
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { primaryUserId: user.id },
    });

    const readings = await seedReadings(user, profile);
    await seedStreak(user, profile);

    console.log(`     ✅ ${readings} reading(s), streak seeded\n`);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  🎉 Cold-start seeding complete");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Tier:                     free  (rate-limited surfaces enforce)");
  console.log("  Onboarding:               complete (lands directly on dashboard)");
  console.log("  Phones (OTP login):");
  for (const p of PROFILES) {
    console.log(`    Day ${p.stageDays.toString().padStart(2)}  ${p.phone}  — ${p.name}`);
  }
  console.log("\n  Use OTP `000000` in dev (auth.otp.provider=log) to skip SMS.");
};

main()
  .catch((err: unknown) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void disconnectDatabase();
  });
