// Admin analytics — a registry of KPI metrics.
//
// Two kinds of metric:
//   - "database" — computed live from Postgres aggregates (implemented).
//   - "posthog"  — derived from PostHog events (retention, voice success,
//     critical-bypass SMS success). PostHog is currently write-only on the
//     server; these are registered + surfaced as unavailable until a
//     PostHog query client is wired. See docs/admin-dashboard-plan.md.
//
// Adding a metric (including Phase 4 KPIs) = one new entry here.

import { prisma } from "../../../shared/database.js";
import { executeHogQL } from "../../../shared/posthog-query.js";

export type MetricSource = "database" | "posthog";

/** A resolved metric, as returned to the console. */
export interface AdminMetricResult {
  key: string;
  label: string;
  description: string;
  source: MetricSource;
  /** False for PostHog metrics not yet wired, or when a DB compute fails. */
  available: boolean;
  /** Computed payload (shape varies per metric); null when unavailable. */
  value: unknown;
  /** Why the metric is unavailable; null when available. */
  note: string | null;
}

interface DatabaseMetric {
  key: string;
  label: string;
  description: string;
  source: "database";
  compute: () => Promise<unknown>;
}

interface PosthogMetric {
  key: string;
  label: string;
  description: string;
  source: "posthog";
  /** Explains where the data lives and why it is not yet surfaced. */
  note: string;
  compute: () => Promise<unknown>;
}

export type AdminMetric = DatabaseMetric | PosthogMetric;

const sinceDays = (days: number): Date => new Date(Date.now() - days * 86_400_000);

const POSTHOG_NOTE =
  "Derived from PostHog events — wire a PostHog query client to surface this " +
  "(see docs/admin-dashboard-plan.md).";

const METRICS: readonly AdminMetric[] = [
  {
    key: "user_growth",
    label: "User growth",
    description: "Total registered users and recent signups.",
    source: "database",
    compute: async () => {
      const [total, last7d, last30d, onboarded, dailyGrowthRaw] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: sinceDays(7) } } }),
        prisma.user.count({ where: { createdAt: { gte: sinceDays(30) } } }),
        prisma.user.count({ where: { onboardingComplete: true } }),
        prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', created_at) AS day, COUNT(*) AS count
          FROM users
          GROUP BY date_trunc('day', created_at)
          ORDER BY day ASC
        `,
      ]);
      const daily = dailyGrowthRaw.map((r) => ({
        date: r.day.toISOString().split("T")[0],
        count: Number(r.count),
      }));
      return { total, last7d, last30d, onboarded, daily };
    },
  },
  {
    key: "tier_distribution",
    label: "Tier distribution",
    description: "Households by subscription tier (monetization view).",
    source: "database",
    compute: async () => {
      // PR 2: tier moved to Household. The unit of billing is the
      // household, so the count is households, not users. Sub-profiles
      // on a shared phone all roll up into one household row.
      const grouped = await prisma.household.groupBy({
        by: ["tier"],
        _count: { _all: true },
        orderBy: { tier: "asc" },
      });
      const byTier: Record<string, number> = { free: 0, premium: 0, family: 0 };
      for (const g of grouped) byTier[g.tier] = g._count._all;
      return { byTier };
    },
  },
  {
    key: "reading_volume",
    label: "Glucose reading volume",
    description: "Total glucose readings and the voice / manual / device split.",
    source: "database",
    compute: async () => {
      const [grouped, dailyRaw] = await Promise.all([
        prisma.glucoseReading.groupBy({
          by: ["source"],
          _count: { _all: true },
          orderBy: { source: "asc" },
        }),
        prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', measured_at) AS day, COUNT(*) AS count
          FROM glucose_readings
          GROUP BY date_trunc('day', measured_at)
          ORDER BY day ASC
        `,
      ]);
      const bySource: Record<string, number> = { manual: 0, voice: 0, device: 0 };
      let total = 0;
      for (const g of grouped) {
        bySource[g.source] = g._count._all;
        total += g._count._all;
      }
      const daily = dailyRaw.map((r) => ({
        date: r.day.toISOString().split("T")[0],
        count: Number(r.count),
      }));
      return { total, bySource, voiceRatio: total > 0 ? (bySource.voice ?? 0) / total : 0, daily };
    },
  },
  {
    key: "chat_cost_tiers",
    label: "Chat cost-tier mix",
    description: "AI chat messages by cost tier (template / cached / sonnet).",
    source: "database",
    compute: async () => {
      const grouped = await prisma.chatMessage.groupBy({
        by: ["costTier"],
        _count: { _all: true },
        orderBy: { costTier: "asc" },
      });
      const byTier: Record<string, number> = { template: 0, cached: 0, sonnet: 0 };
      let total = 0;
      for (const g of grouped) {
        byTier[g.costTier] = g._count._all;
        total += g._count._all;
      }
      return { total, byTier };
    },
  },
  {
    key: "chat_safety",
    label: "Chat safety rejections",
    description: "Share of AI chat messages flagged by the safety filter.",
    source: "database",
    compute: async () => {
      const [total, flagged] = await Promise.all([
        prisma.chatMessage.count(),
        prisma.chatMessage.count({ where: { flagged: true } }),
      ]);
      return {
        totalMessages: total,
        flaggedMessages: flagged,
        flaggedRate: total > 0 ? flagged / total : 0,
      };
    },
  },
  {
    key: "guardian_health",
    label: "Silent Guardian health",
    description: "Signal sources, alert severities, and alert delivery success.",
    source: "database",
    compute: async () => {
      const [signals, alerts, totalAlerts, pushDelivered, smsDelivered] = await Promise.all([
        prisma.silentGuardianSignal.groupBy({
          by: ["signalSource"],
          _count: { _all: true },
          orderBy: { signalSource: "asc" },
        }),
        prisma.guardianAlert.groupBy({
          by: ["severity"],
          _count: { _all: true },
          orderBy: { severity: "asc" },
        }),
        prisma.guardianAlert.count(),
        prisma.guardianAlert.count({ where: { pushDelivered: true } }),
        prisma.guardianAlert.count({ where: { smsDelivered: true } }),
      ]);
      return {
        signalsBySource: Object.fromEntries(signals.map((g) => [g.signalSource, g._count._all])),
        alertsBySeverity: Object.fromEntries(alerts.map((g) => [g.severity, g._count._all])),
        totalAlerts,
        pushDelivered,
        smsDelivered,
      };
    },
  },
  {
    key: "streak_distribution",
    label: "Streak distribution",
    description: "Patient users bucketed by current streak length.",
    source: "database",
    compute: async () => {
      const res = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT 
          CASE 
            WHEN current_streak_days <= 0 THEN 'd0'
            WHEN current_streak_days < 7 THEN 'd1_6'
            WHEN current_streak_days < 14 THEN 'd7_13'
            WHEN current_streak_days < 30 THEN 'd14_29'
            ELSE 'd30plus'
          END as bucket,
          COUNT(*) as count
        FROM user_streaks
        GROUP BY 1
      `;
      const buckets = { d0: 0, d1_6: 0, d7_13: 0, d14_29: 0, d30plus: 0 };
      let totalUsersWithStreak = 0;
      for (const row of res) {
        const cnt = Number(row.count);
        totalUsersWithStreak += cnt;
        if (row.bucket in buckets) {
          buckets[row.bucket as keyof typeof buckets] = cnt;
        }
      }
      return { totalUsersWithStreak, buckets };
    },
  },
  {
    key: "medication_adherence",
    label: "Medication adherence",
    description: "Medication-log outcomes (taken / skipped / missed / delayed).",
    source: "database",
    compute: async () => {
      const grouped = await prisma.medicationLog.groupBy({
        by: ["status"],
        _count: { _all: true },
        orderBy: { status: "asc" },
      });
      const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
      const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
      return { total, byStatus, takenRate: total > 0 ? (byStatus.taken ?? 0) / total : 0 };
    },
  },
  {
    key: "critical_bypass_sms_success_rate",
    label: "Critical-bypass SMS success rate",
    description:
      "URGENT ops metric — share of critical-low/high alerts whose SMS fallback was delivered.",
    source: "posthog",
    note: `${POSTHOG_NOTE} Event: critical_bypass_triggered{sms_success}.`,
    compute: async () => {
      const q = `
        SELECT
          count() as total,
          countIf(properties.sms_success = 'true') as success
        FROM events
        WHERE event = 'critical_bypass_triggered'
        AND timestamp >= toStartOfDay(now() - INTERVAL 30 DAY)
      `;
      const res = await executeHogQL<[number, number]>(q);
      if (!res) return null; // Unwired
      const total = res.results[0]?.[0] ?? 0;
      const success = res.results[0]?.[1] ?? 0;
      return { total, success, rate: total > 0 ? success / total : 0 };
    },
  },
  {
    key: "voice_success_rate",
    label: "Voice logging success rate",
    description: "Share of voice-logging attempts that parsed without falling back to numpad.",
    source: "posthog",
    note: `${POSTHOG_NOTE} Event: voice_attempt{success,fallback}.`,
    compute: async () => {
      const q = `
        SELECT
          count() as total,
          countIf(properties.success = 'true') as success
        FROM events
        WHERE event = 'voice_attempt'
        AND timestamp >= toStartOfDay(now() - INTERVAL 30 DAY)
      `;
      const res = await executeHogQL<[number, number]>(q);
      if (!res) return null;
      const total = res.results[0]?.[0] ?? 0;
      const success = res.results[0]?.[1] ?? 0;
      return { total, success, rate: total > 0 ? success / total : 0 };
    },
  },
  {
    key: "retention",
    label: "Retention (D1/D3/D7/D14/D30)",
    description: "Cohort retention by days since first app open.",
    source: "posthog",
    note: `${POSTHOG_NOTE} Events: app_opened, reading_logged.`,
    compute: async () => {
      const q = `
        SELECT count() as opened
        FROM events
        WHERE event = 'app_opened'
        AND timestamp >= toStartOfDay(now() - INTERVAL 30 DAY)
      `;
      const res = await executeHogQL<[number]>(q);
      if (!res) return null;
      return {
        note: "Retention query simplified for demo",
        app_opened_30d: res.results[0]?.[0] ?? 0,
      };
    },
  },
];

/** All registered metrics, in display order. */
export const adminMetrics = (): readonly AdminMetric[] => METRICS;

/** Look up one metric by key. */
export const getAdminMetric = (key: string): AdminMetric | undefined =>
  METRICS.find((m) => m.key === key);
