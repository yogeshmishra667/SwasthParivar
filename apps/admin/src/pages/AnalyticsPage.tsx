import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAnalyticsOverview } from "@/api/queries";
import type { AdminMetricResult } from "@/api/types";
import { humanizeApiError } from "@/lib/errorMessage";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const matchesQuery = (m: AdminMetricResult, q: string): boolean => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    m.key.toLowerCase().includes(needle) ||
    m.label.toLowerCase().includes(needle) ||
    m.description.toLowerCase().includes(needle)
  );
};

interface MetricDetailProps {
  metric: AdminMetricResult;
}

function MetricDetail({ metric }: MetricDetailProps) {
  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{metric.label}</CardTitle>
            <CardDescription className="font-mono text-xs">{metric.key}</CardDescription>
          </div>
          <div className="flex gap-1.5">
            <Badge variant="outline" className="capitalize">
              {metric.source}
            </Badge>
            <Badge variant={metric.available ? "success" : "secondary"}>
              {metric.available ? "available" : "unavailable"}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{metric.description}</p>
      </CardHeader>
      <CardContent>
        {metric.available ? (
          <JsonViewer value={metric.value} className="max-h-64" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {metric.note ??
              "No value — see the deferred PostHog follow-up in admin-dashboard-progress.md."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const { data, isLoading, isError, error } = useAnalyticsOverview();
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Every metric in the analytics registry, with its full raw payload. Use Overview for
          at-a-glance KPIs; come here when you need the underlying numbers.
        </p>
      </header>

      <Input
        placeholder="Filter by key, label, or description…"
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
        }}
        className="max-w-sm"
      />

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load analytics</AlertTitle>
          <AlertDescription>{humanizeApiError(error)}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`s-${String(i)}`} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.metrics
            .filter((m) => matchesQuery(m, query))
            .map((m) => (
              <MetricDetail key={m.key} metric={m} />
            ))}
        </div>
      )}
    </div>
  );
}
