import { useAnalyticsOverview } from "@/api/queries";
import { KpiCard } from "@/components/shared/KpiCard";

const formatValue = (value: unknown): string => {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
};

export function OverviewPage() {
  const { data, isLoading } = useAnalyticsOverview();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Live KPIs from the analytics registry. Detail pages coming in M3.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading ? (
          <>
            {Array.from({ length: 6 }, (_, i) => (
              <KpiCard key={`s-${String(i)}`} title="" value={null} />
            ))}
          </>
        ) : (
          data?.metrics.map((m) => (
            <KpiCard
              key={m.key}
              title={m.label}
              value={m.available ? formatValue(m.value) : null}
              unavailable={!m.available ? (m.note ?? "Unavailable") : null}
              caption={m.description}
            />
          ))
        )}
      </div>
    </div>
  );
}
