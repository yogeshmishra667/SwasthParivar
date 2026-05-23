import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          KPI charts and metric drill-downs land in M3-T4.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Coming in M3-T4</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Live metrics already flow via the analytics registry — see the Overview tab for the
          current set.
        </CardContent>
      </Card>
    </div>
  );
}
