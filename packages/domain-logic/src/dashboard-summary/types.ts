// Phase 2 step 6 — Dashboard summary input/output. Pure data; the
// caller (dashboard service) maps Prisma rows + cached state into this
// shape so the natural-language composition stays pure and testable.

/** Glucose reading reduced to what the summary needs. */
export interface DashboardGlucoseReading {
  valueMgDl: number;
  readingType: "fasting" | "pre_meal" | "post_meal" | "random" | "bedtime";
  measuredAt: string; // ISO 8601
}

/** BP reading reduced to what the summary needs. */
export interface DashboardBpReading {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  measuredAt: string;
}

/** Optional health-score snapshot for the trend line. */
export interface DashboardHealthScoreSnapshot {
  score: number;
  components: {
    logging: number;
    stability: number;
    trend: number;
    medication: number;
    streak: number;
  };
}

export interface DashboardSummaryInput {
  // Today's readings (user-local day). Caller filters by user timezone
  // before passing in — domain logic stays timezone-agnostic.
  todayGlucose: readonly DashboardGlucoseReading[];
  todayBp: readonly DashboardBpReading[];
  // Yesterday's same-type readings used for the "kal se behtar" line.
  yesterdayFasting: readonly DashboardGlucoseReading[];
  // Health score for "today" (most-recent stored row from step 5).
  healthScore: DashboardHealthScoreSnapshot | null;
  // Streak — drives the gentle "X din ki streak" sentence.
  currentStreakDays: number;
  // Days since the user started using the app. < 7 → use cold-start copy.
  userStageDays: number;
  // Language preference. Hindi is the primary surface; English is the
  // fallback for users who switched the toggle.
  language: "hi" | "en";
}

export interface DashboardSummary {
  /** Headline sentence — what to say in one breath. Always non-empty. */
  headline: string;
  /** Up to 3 short detail lines (glucose, BP, trend). May be empty. */
  details: readonly string[];
  /** Language the summary was rendered in. */
  language: "hi" | "en";
  /** Whether this is a cold-start / first-week summary (UI may style it). */
  coldStart: boolean;
}
