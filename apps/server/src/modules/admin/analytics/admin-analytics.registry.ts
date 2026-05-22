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
      const [total, last7d, last30d, onboarded] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: sinceDays(7) } } }),
        prisma.user.count({ where: { createdAt: { gte: sinceDays(30) } } }),
        prisma.user.count({ where: { onboardingComplete: true } }),
      ]);
      return { total, last7d, last30d, onboarded };
    },
  },
  {
    key: "tier_distribution",
    label: "Tier distribution",
    description: "Patient users by subscription tier (monetization view).",
    source: "database",
    compute: async () => {
      const grouped = await prisma.user.groupBy({
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
      const grouped = await prisma.glucoseReading.groupBy({
        by: ["source"],
        _count: { _all: true },
        orderBy: { source: "asc" },
      });
      const bySource: Record<string, number> = { manual: 0, voice: 0, device: 0 };
      let total = 0;
      for (const g of grouped) {
        bySource[g.source] = g._count._all;
        total += g._count._all;
      }
      return { total, bySource, voiceRatio: total > 0 ? (bySource.voice ?? 0) / total : 0 };
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
      const streaks = await prisma.userStreak.findMany({ select: { currentStreakDays: true } });
      const buckets = { d0: 0, d1_6: 0, d7_13: 0, d14_29: 0, d30plus: 0 };
      for (const s of streaks) {
        const d = s.currentStreakDays;
        if (d <= 0) buckets.d0++;
        else if (d < 7) buckets.d1_6++;
        else if (d < 14) buckets.d7_13++;
        else if (d < 30) buckets.d14_29++;
        else buckets.d30plus++;
      }
      return { totalUsersWithStreak: streaks.length, buckets };
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
  },
  {
    key: "voice_success_rate",
    label: "Voice logging success rate",
    description: "Share of voice-logging attempts that parsed without falling back to numpad.",
    source: "posthog",
    note: `${POSTHOG_NOTE} Event: voice_attempt{success,fallback}.`,
  },
  {
    key: "retention",
    label: "Retention (D1/D3/D7/D14/D30)",
    description: "Cohort retention by days since first app open.",
    source: "posthog",
    note: `${POSTHOG_NOTE} Events: app_opened, reading_logged.`,
  },
];

/** All registered metrics, in display order. */
export const adminMetrics = (): readonly AdminMetric[] => METRICS;

/** Look up one metric by key. */
export const getAdminMetric = (key: string): AdminMetric | undefined =>
  METRICS.find((m) => m.key === key);
