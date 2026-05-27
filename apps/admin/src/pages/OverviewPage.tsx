import { useMemo, type ReactNode } from "react";
import { AreaChart, Area, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { AlertCircle } from "lucide-react";
import { useAnalyticsOverview } from "@/api/queries";
import type { AdminMetricResult } from "@/api/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { JsonViewer } from "@/components/shared/JsonViewer";

// ── Helpers ──────────────────────────────────────────────────────

const num = (n: number): string => n.toLocaleString();
const pct = (r: number): string => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;

interface DistRow {
  label: string;
  count: number;
}

function DistributionList({ rows }: { rows: DistRow[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const ratio = r.count / total;
        return (
          <li key={r.label} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium capitalize">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {num(r.count)} · {pct(ratio)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(ratio * 100).toFixed(1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Per-key value renderer ───────────────────────────────────────

interface UserGrowthValue {
  total: number;
  last7d: number;
  last30d: number;
  onboarded: number;
  daily?: { date: string; count: number }[];
}
type DistMap = Record<string, number>;
interface ReadingVolumeValue {
  total: number;
  bySource: DistMap;
  voiceRatio: number;
  daily?: { date: string; count: number }[];
}
interface MedAdherenceValue {
  total: number;
  byStatus: DistMap;
  takenRate: number;
}

function TinyChart({ data }: { data: { date: string; count: number }[] | undefined }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="mt-4 h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.2}
          />
          <RechartsTooltip
            contentStyle={{
              fontSize: "12px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", marginBottom: "2px" }}
            formatter={(val) => [val, "Count"]}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const renderMetric = (m: AdminMetricResult): ReactNode => {
  const v = m.value;
  switch (m.key) {
    case "user_growth": {
      const u = v as UserGrowthValue;
      return (
        <div className="space-y-1">
          <div className="text-2xl font-semibold tabular-nums">{num(u.total)}</div>
          <p className="text-xs text-muted-foreground">
            +{num(u.last7d)} this week · +{num(u.last30d)} this month · {num(u.onboarded)} onboarded
          </p>
          <TinyChart data={u.daily} />
        </div>
      );
    }
    case "tier_distribution": {
      const t = v as { byTier: DistMap };
      return (
        <DistributionList
          rows={Object.entries(t.byTier).map(([label, count]) => ({ label, count }))}
        />
      );
    }
    case "reading_volume": {
      const r = v as ReadingVolumeValue;
      return (
        <div className="space-y-1">
          <div className="text-2xl font-semibold tabular-nums">{num(r.total)}</div>
          <p className="text-xs text-muted-foreground">
            {pct(r.voiceRatio)} via voice ({num(r.bySource.voice ?? 0)} of {num(r.total)})
          </p>
          <TinyChart data={r.daily} />
        </div>
      );
    }
    case "medication_adherence": {
      const a = v as MedAdherenceValue;
      return (
        <div className="space-y-1">
          <div className="text-2xl font-semibold tabular-nums">{pct(a.takenRate)}</div>
          <p className="text-xs text-muted-foreground">
            {num(a.byStatus.taken ?? 0)} taken of {num(a.total)} reminders
          </p>
        </div>
      );
    }
    case "chat_cost_tiers": {
      const c = v as { total: number; byTier: DistMap };
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold tabular-nums">{num(c.total)}</div>
          <DistributionList
            rows={Object.entries(c.byTier).map(([label, count]) => ({ label, count }))}
          />
        </div>
      );
    }
    case "streak_distribution": {
      const s = v as { totalUsersWithStreak: number; buckets: DistMap };
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold tabular-nums">{num(s.totalUsersWithStreak)}</div>
          <DistributionList
            rows={Object.entries(s.buckets).map(([label, count]) => ({ label, count }))}
          />
        </div>
      );
    }
    default:
      return <JsonViewer value={v} className="max-h-32" />;
  }
};

// ── Section grouping ─────────────────────────────────────────────

interface Section {
  title: string;
  description?: string;
  keys: readonly string[];
}

// Critical-bypass SMS success rate is broken out into its own banner;
// it's a CLAUDE.md "URGENT" operational metric and shouldn't compete
// for attention with day-to-day KPIs.
const SECTIONS: readonly Section[] = [
  {
    title: "Users & growth",
    keys: ["user_growth", "tier_distribution", "streak_distribution"],
  },
  {
    title: "Activity",
    keys: ["reading_volume", "medication_adherence"],
  },
  {
    title: "AI chat",
    keys: ["chat_cost_tiers", "chat_safety"],
  },
  {
    title: "Safety & guardian",
    keys: ["guardian_health"],
  },
  {
    title: "Not yet wired",
    description: "Derived from PostHog events — surface arrives with the query-client follow-up.",
    keys: ["voice_success_rate", "retention"],
  },
];

const CRITICAL_KEY = "critical_bypass_sms_success_rate";

// ── Sub-components ───────────────────────────────────────────────

interface MetricCardProps {
  metric: AdminMetricResult;
}

function MetricCard({ metric }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{metric.label}</CardTitle>
        <CardDescription className="text-xs">{metric.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {metric.available ? (
          renderMetric(metric)
        ) : (
          <div>
            <div className="text-2xl font-semibold text-muted-foreground/60">—</div>
            <p className="mt-1 text-xs text-muted-foreground">{metric.note ?? "Unavailable"}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CriticalSmsBanner({ metric }: { metric: AdminMetricResult }) {
  if (!metric.available) {
    return (
      <Alert variant="warning">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Critical-bypass SMS success — metric not yet wired</AlertTitle>
        <AlertDescription>
          {metric.note ??
            "URGENT per CLAUDE.md. Wire a PostHog query client to surface this rate live."}
        </AlertDescription>
      </Alert>
    );
  }
  const v = metric.value as {
    rate: number;
    total: number;
    success: number;
  };
  const ok = v.rate >= 0.95;
  return (
    <Alert variant={ok ? "success" : "destructive"}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Critical-bypass SMS success — {pct(v.rate)}</AlertTitle>
      <AlertDescription>
        {num(v.success)} of {num(v.total)} alerts delivered · target ≥ 95%.
      </AlertDescription>
    </Alert>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={`s-${String(i)}`}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-44" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function OverviewPage() {
  const { data, isLoading, isError } = useAnalyticsOverview();

  const byKey = useMemo<Map<string, AdminMetricResult>>(() => {
    const m = new Map<string, AdminMetricResult>();
    data?.metrics.forEach((r) => m.set(r.key, r));
    return m;
  }, [data]);

  const critical = byKey.get(CRITICAL_KEY);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Live KPIs from the analytics registry. Click into Analytics for per-metric drill-downs.
        </p>
      </header>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load metrics</AlertTitle>
          <AlertDescription>
            The analytics endpoint returned an error. Try refreshing — the server logs will have
            details.
          </AlertDescription>
        </Alert>
      ) : null}

      {critical ? <CriticalSmsBanner metric={critical} /> : null}

      {isLoading ? (
        <SkeletonGrid />
      ) : (
        SECTIONS.map((sec) => {
          const metrics = sec.keys
            .map((k) => byKey.get(k))
            .filter((m): m is AdminMetricResult => m !== undefined);
          if (metrics.length === 0) return null;
          return (
            <section key={sec.title} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </h2>
                {sec.description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{sec.description}</p>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {metrics.map((m) => (
                  <MetricCard key={m.key} metric={m} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
